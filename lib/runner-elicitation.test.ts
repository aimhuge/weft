// @vitest-environment node
// An MCP server's elicitation through a thread's onElicitation (lib/elicitation.ts, lib/runner-session.ts):
// a Needs-you prompt on the card whose answer goes back to the server, against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, type FakeQuery } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;

async function send(id: string) {
  runner.sendMessage(id, "hello");
  await flush();
  return nth(h.queries, -1, "query");
}

type Elicit = (request: Record<string, unknown>, opts: { signal: AbortSignal; requestId: string }) => Promise<unknown>;
const elicit = (q: FakeQuery, request: Record<string, unknown>, signal = new AbortController().signal) =>
  (q.options.onElicitation as Elicit)(request, { signal, requestId: "r1" });

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("MCP elicitation", () => {
  const destructive = { serverName: "supabase", message: "This query is destructive. Run it?" };

  it("puts the server's question on the card as Needs you, and Accept goes back to the server", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const promise = elicit(q, destructive);
    expect(card("c1")).toMatchObject({
      column: "needs_you",
      pending: { toolName: "mcp__supabase__elicitation", title: "supabase: This query is destructive. Run it?", elicitation: { server: "supabase", fields: [] } },
    });
    expect(card("c1").pending?.why).toBeUndefined();
    runner.answerPermission("c1", true);
    await expect(promise).resolves.toEqual({ action: "accept" });
  });

  it("sends a form's typed values, and Decline as a decline", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const form = elicit(q, { ...destructive, requestedSchema: { properties: { n: { type: "integer" } }, required: ["n"] } });
    runner.answerPermission("c1", true, { n: "3" });
    await expect(form).resolves.toEqual({ action: "accept", content: { n: 3 } });
    const second = elicit(q, destructive);
    runner.answerPermission("c1", false);
    await expect(second).resolves.toEqual({ action: "decline" });
  });

  it("cancels when the call stops before anyone answers", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const controller = new AbortController();
    const promise = elicit(q, destructive, controller.signal);
    controller.abort();
    await expect(promise).resolves.toEqual({ action: "cancel" });
    expect(card("c1").pending).toBeFalsy();
  });
});

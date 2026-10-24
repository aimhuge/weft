// @vitest-environment node
// Auto mode's classifier denials (lib/classifier-denial.ts) through the runner, against the fake SDK in lib/runner.harness.ts.
import type { HookCallbackMatcher, HookInput, Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

const MIGRATE = "mcp__supabase__apply_migration";
const input = { name: "add_x", query: "create table x ()" };
const denied = {
  type: "system",
  subtype: "permission_denied",
  tool_name: MIGRATE,
  tool_use_id: "tu1",
  decision_reason_type: "classifier",
  decision_reason: "Applying a migration to production",
  message: "Denied by auto mode",
};
const deniedResult = (text: string) => success(text, { permission_denials: [{ tool_name: MIGRATE, tool_use_id: "tu1", tool_input: input }] });

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

async function deniedTurn() {
  addCard({ id: "c1", permissionMode: "auto" });
  runner.sendMessage("c1", "apply it");
  await flush();
  lastQuery().emit(denied, deniedResult("It was blocked; approve it"));
  await flush();
}

describe("a classifier denial", () => {
  it("parks the card in Needs you with the tool, the classifier's reason and the call", async () => {
    await deniedTurn();
    expect(card("c1")).toMatchObject({
      column: "needs_you",
      pending: { toolName: MIGRATE, input, why: { category: "classifier", detail: "Applying a migration to production" } },
    });
    expect(thread("c1")).toContainEqual(expect.objectContaining({ kind: "permission", toolName: MIGRATE }));
  });

  it("Allow once and retry tells the thread to retry, and lets that exact call through once", async () => {
    await deniedTurn();
    const q = lastQuery();
    runner.answerPermission("c1", true);
    await flush();
    expect(card("c1").column).toBe("running");
    expect(q.received.at(-1)).toMatch(/Retry exactly that call now/);
    const hooks: HookCallbackMatcher[] = (q.options as unknown as Options).hooks?.PreToolUse ?? [];
    const grant = nth(nth(hooks, -1).hooks, 0);
    const call = { hook_event_name: "PreToolUse", tool_name: MIGRATE, tool_input: input } as HookInput;
    const signal = new AbortController().signal;
    expect(await grant(call, "tu2", { signal })).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(await grant(call, "tu3", { signal })).toEqual({});
  });

  it("Keep denied puts the card back in the column the turn ended in", async () => {
    await deniedTurn();
    runner.answerPermission("c1", false);
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", pending: null });
    expect(lastQuery().received).toHaveLength(1);
  });

  it("a reply instead of a click moves on from the prompt", async () => {
    await deniedTurn();
    runner.sendMessage("c1", "never mind");
    await flush();
    expect(card("c1")).toMatchObject({ column: "running", pending: null });
    expect(thread("c1")).toContainEqual(expect.objectContaining({ kind: "permission", toolName: MIGRATE, decision: "deny" }));
  });
});

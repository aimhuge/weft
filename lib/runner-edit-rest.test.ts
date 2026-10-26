// @vitest-environment node
// The last of lib/runner.ts: editing the last message of a card whose conversation can't be rewound,
// and closing a CLI that has a question waiting. Same harness setup as lib/runner.test.ts, so the
// cards, queries and mocks work the same way.
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
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("editing the last message of a card with no session", () => {
  it("sends the edit as a new message, with no rewind point", async () => {
    addCard({ id: "c1", sessionId: "s1" });
    const first = await send("c1", "one");
    first.emit(success("ok", { session_id: "s1" }));
    await flush();
    // The card's conversation id is gone (the CLI was reset), so there is nothing to rewind to.
    card("c1").sessionId = undefined;
    await runner.editLastMessage("c1", "two");
    await flush();
    expect(thread("c1").filter((i) => i.kind === "user").map((i) => (i as { text: string }).text)).toEqual(["one", "two"]);
    expect(lastQuery().options).toMatchObject({ resume: undefined, resumeSessionAt: undefined });
  });

  it("sends the edit on a card that was deleted while its CLI was closing", async () => {
    addCard({ id: "c1", sessionId: "s1" });
    const first = await send("c1", "one");
    first.emit(success("ok", { session_id: "s1" }));
    await flush();
    // The card is gone by the time the CLI has closed. The edit reads the card it started with,
    // so it gets as far as sending — and then says the card is gone.
    const store = await import("./store");
    const real = store.getCard;
    let seen = 0;
    const spy = vi.spyOn(store, "getCard").mockImplementation((id: string) => {
      seen++;
      // The first look is the one at the top of editLastMessage; after that the card is gone.
      return seen === 1 ? real(id) : undefined;
    });
    await expect(runner.editLastMessage("c1", "two")).rejects.toThrow("No such card.");
    spy.mockRestore();
  });
});

describe("ending a CLI with a question waiting", () => {
  it("denies the question and closes the CLI", async () => {
    addCard({ id: "c1" });
    await send("c1");
    const state = await import("./runner-state");
    const session = state.sessions.get("c1")!;
    // A permission request the CLI asked for and nobody answered.
    thread("c1").push({ kind: "permission", id: "p1", toolName: "Bash", title: "Run a command", at: 0 });
    session.pending.push({
      id: "p1",
      index: thread("c1").length - 1,
      toolName: "Bash",
      title: "Run a command",
      input: { command: "ls" },
      resolve: () => {},
    });
    await runner.endSession("c1");
    expect(session.pending).toHaveLength(0);
    expect(state.sessions.has("c1")).toBe(false);
  });
});

// A session that's gone: the CLI was asked to resume a conversation it has no transcript for. The card goes on in a
// fresh session from a brief of its thread, with the last message sent again, once, though the CLI reports it twice.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failure, flush, init, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./splice-brief", () => ({ briefFor: () => Promise.resolve("BRIEF "), prebakeBrief: () => Promise.resolve() }));

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");
const GONE = "No conversation found with session ID: gone";

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(path.dirname(cwd));
  vi.restoreAllMocks();
});

describe("a lost session", () => {
  it("re-sends the last message in a fresh session from a brief, once for both reports", async () => {
    addCard({ id: "c1", sessionId: "gone" });
    runner.sendMessage("c1", "please");
    await flush(1);
    const q = lastQuery();
    expect(q.options.resume).toBe("gone");
    q.emit(success(GONE, { is_error: true }));
    q.fail(new Error(`Claude Code returned an error result: ${GONE}`));
    await vi.waitFor(() => expect(h.queries).toHaveLength(2));
    expect(lastQuery().options.resume).toBeUndefined();
    await vi.waitFor(() => expect(lastQuery().received).toHaveLength(1));
    expect(lastQuery().received).toEqual(["BRIEF please"]);
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
    expect(thread("c1").some((i) => i.kind === "spliced")).toBe(true);
    expect(card("c1")).toMatchObject({ column: "running", error: undefined });
    expect(card("c1").sessionId).not.toBe("gone");
  });

  it("does the same when only the CLI's exit error says so", async () => {
    addCard({ id: "c1", sessionId: "gone" });
    runner.sendMessage("c1", "please");
    await flush(1);
    lastQuery().fail(new Error(`Claude Code returned an error result: ${GONE}`));
    await vi.waitFor(() => expect(h.queries).toHaveLength(2));
    await vi.waitFor(() => expect(lastQuery().received).toEqual(["BRIEF please"]));
  });

  // puku's shape: a bare error_during_execution under a new id it never writes, the reason only in the exit error.
  it("keeps the card's id through a resume refused before any turn, then goes on fresh", async () => {
    addCard({ id: "c1", sessionId: "gone" });
    runner.sendMessage("c1", "please");
    await flush(1);
    lastQuery().emit(failure("error_during_execution", { num_turns: 0, session_id: "phantom" }));
    await flush();
    expect(card("c1").sessionId).toBe("gone");
    lastQuery().fail(new Error(`Claude Code returned an error result: ${GONE}`));
    await vi.waitFor(() => expect(lastQuery().received).toEqual(["BRIEF please"]));
    expect(card("c1").sessionId).not.toBe("phantom");
  });

  it("is an ordinary error on a session that wasn't resumed", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "please");
    await flush(1);
    lastQuery().emit(init("new"), success(GONE, { is_error: true }));
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(card("c1").error).toContain("No conversation found");
  });
});

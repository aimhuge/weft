// The cap on threads running at once: past it a message waits on its card for a free slot (lib/thread-slots.ts)
// and goes out, oldest first, as a running turn ends.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const queryOf = (n: number) => nth(h.queries, n, "query");

beforeEach(async () => {
  cwd = resetHarness(h);
  h.maxThreads = 1;
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("the cap on running threads", () => {
  it("holds a second thread's first message until the first turn ends, then sends it", async () => {
    addCard({ id: "a" });
    addCard({ id: "b" });
    runner.sendUserMessage("a", "build");
    await flush();
    runner.sendUserMessage("b", "also build");
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(card("b").scheduled).toMatchObject([{ text: "also build", forSlot: true }]);
    expect(h.threads.get("b") ?? []).toEqual([]);

    queryOf(0).emit(success("done"));
    await flush(3);
    expect(card("b").scheduled).toBeUndefined();
    expect(h.queries).toHaveLength(2);
    expect(queryOf(1).received).toEqual(["also build"]);
    expect(card("b").column).toBe("running");
  });

  it("a /done wrap-up that has to wait is wrapping up, not archived early", async () => {
    addCard({ id: "a" });
    addCard({ id: "b" });
    runner.sendUserMessage("a", "build");
    await flush();
    runner.sendUserMessage("b", "/weft:done");
    expect(card("b").wrappingUp).toBe(true);
    expect(card("b").archived).not.toBe(true);
  });

  it("raising the cap lets the waiting thread go at once", async () => {
    addCard({ id: "a" });
    addCard({ id: "b" });
    runner.sendUserMessage("a", "build");
    await flush();
    runner.sendUserMessage("b", "also build");
    h.maxThreads = 2;
    runner.freeSlots();
    await flush();
    expect(h.queries).toHaveLength(2);
  });

  it("doesn't hold anything with no limit", async () => {
    h.maxThreads = 0;
    addCard({ id: "a" });
    addCard({ id: "b" });
    runner.sendUserMessage("a", "build");
    runner.sendUserMessage("b", "also build");
    await flush();
    expect(h.queries).toHaveLength(2);
  });
});

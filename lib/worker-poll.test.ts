// @vitest-environment jsdom
// The thread poll over the relay (lib/worker-poll.ts): delta reads, the pace, hidden windows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadPage } from "./thread-page";
import { clearActiveCards, isActiveCard, markWholeRead, setActiveCards, startThreadPoll, THREAD_IDLE_POLL_MS, THREAD_POLL_MS, wakeCard, WHOLE_PAGE_EVERY, workerOfCard } from "./worker-poll";
import { getWorkerRoute, resetWorkerRoute } from "./worker-route";

const page = (over: Partial<ThreadPage> = {}): ThreadPage => ({ items: [], start: 0, total: 0, ...over });
const item = (text: string) => ({ kind: "user" as const, text, at: 0 });

let hidden = false;
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  clearActiveCards();
  resetWorkerRoute();
});

afterEach(() => {
  vi.useRealTimers();
  clearActiveCards();
});

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function start(pages: (ThreadPage | null)[]) {
  const queue = [...pages];
  const fetchPage = vi.fn<(after?: number) => Promise<ThreadPage | null>>(() => Promise.resolve(queue.length > 1 ? queue.shift()! : (queue[0] ?? null)));
  const apply = vi.fn();
  const stop = startThreadPoll({ cardId: "c1", fetchPage, apply });
  return { fetchPage, apply, stop };
}

describe("isActiveCard", () => {
  it("counts a card the board hasn't seen as active", () => {
    expect(isActiveCard("c1")).toBe(true);
  });

  it("is active while the card runs or waits on you, idle otherwise", () => {
    setActiveCards([{ id: "r", column: "running", cwd: "worker://w1/ling" }, { id: "n", column: "needs_you", cwd: "worker://w1/ling" }, { id: "d", column: "review", cwd: "worker://w1/ling" }]);
    expect([isActiveCard("r"), isActiveCard("n"), isActiveCard("d")]).toEqual([true, true, false]);
  });
});

describe("startThreadPoll", () => {
  it("reads the whole newest page first, then only what's past the last item", async () => {
    const { fetchPage, apply, stop } = start([page({ items: [item("a"), item("b"), item("c")], total: 3 }), page({ total: 3 })]);
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenLastCalledWith(undefined);
    expect(apply).toHaveBeenCalledTimes(1);
    // A running card re-asks for its last item, which can change in place.
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    stop();
  });

  it("asks for nothing it has when the card is idle", async () => {
    setActiveCards([{ id: "c1", column: "review", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page({ items: [item("a"), item("b")], total: 2 }), page({ total: 2 })]);
    await tick(THREAD_IDLE_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await tick(THREAD_IDLE_POLL_MS);
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    stop();
  });

  it("polls an idle card every 30 s, not every 2.5 s", async () => {
    setActiveCards([{ id: "c1", column: "done", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page()]);
    await tick(THREAD_POLL_MS * 10);
    expect(fetchPage).not.toHaveBeenCalled();
    await tick(THREAD_IDLE_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    stop();
  });

  it("goes to the fast pace when an idle card starts running", async () => {
    setActiveCards([{ id: "c1", column: "review", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page()]);
    await tick(1_000);
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    stop();
  });

  it("doesn't reset its timer when the board reads and nothing woke", async () => {
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page()]);
    await tick(2_000);
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    await tick(500);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads the newest page whole when an empty answer says the thread got shorter", async () => {
    const { fetchPage, apply, stop } = start([page({ items: [item("a"), item("b"), item("c")], total: 3 }), page({ start: 2, total: 1 }), page({ items: [item("a")], total: 1 })]);
    await tick(THREAD_POLL_MS * 2);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenLastCalledWith();
    expect(apply).toHaveBeenLastCalledWith(page({ items: [item("a")], total: 1 }));
    stop();
  });

  it("keeps going after a read that fails", async () => {
    const { fetchPage, apply, stop } = start([null]);
    await tick(THREAD_POLL_MS * 2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
    expect(getWorkerRoute("w1")).toBeNull();
    stop();
  });

  it("notes the round trip as the relay's", async () => {
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    const fetchPage = vi.fn(() => new Promise<ThreadPage>((resolve) => setTimeout(() => resolve(page()), 120)));
    const stop = startThreadPoll({ cardId: "c1", fetchPage, apply: vi.fn() });
    await tick(THREAD_POLL_MS + 120);
    expect(getWorkerRoute("w1")).toMatchObject({ via: "relay", ms: 120 });
    stop();
  });

  it("doesn't start a second read while one is in flight", async () => {
    let release: (() => void) | undefined;
    const fetchPage = vi.fn(() => new Promise<ThreadPage>((resolve) => (release = () => resolve(page()))));
    const stop = startThreadPoll({ cardId: "c1", fetchPage, apply: vi.fn() });
    await tick(THREAD_POLL_MS * 3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    release?.();
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    stop();
  });

  it("pauses while the window is hidden and reads at once on return", async () => {
    const { fetchPage, stop } = start([page()]);
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    setHidden(true);
    await tick(THREAD_POLL_MS * 20);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    setHidden(false);
    await tick(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    stop();
  });

  it("doesn't read when the window hides with a read already due", async () => {
    const { fetchPage, stop } = start([page()]);
    hidden = true;
    await tick(THREAD_POLL_MS * 2);
    expect(fetchPage).not.toHaveBeenCalled();
    stop();
  });

  it("ignores a visibility change that is still hidden", async () => {
    const { fetchPage, stop } = start([page()]);
    setHidden(true);
    await tick(0);
    expect(fetchPage).not.toHaveBeenCalled();
    stop();
  });

  it("doesn't apply a page that arrives after it was stopped", async () => {
    let release: (() => void) | undefined;
    const apply = vi.fn();
    const stop = startThreadPoll({ cardId: "c1", fetchPage: () => new Promise<ThreadPage>((resolve) => (release = () => resolve(page({ total: 1 })))), apply });
    await tick(THREAD_POLL_MS);
    stop();
    release?.();
    await tick(THREAD_POLL_MS * 2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("stops reading when stopped", async () => {
    const { fetchPage, stop } = start([page()]);
    await tick(THREAD_POLL_MS);
    stop();
    await tick(THREAD_POLL_MS * 5);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    setHidden(false);
    await tick(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("does one more read with the last item re-asked when the card goes idle", async () => {
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page({ items: [item("a"), item("b"), item("c")], total: 3 })]);
    await tick(THREAD_POLL_MS);
    setActiveCards([{ id: "c1", column: "review", cwd: "worker://w1/ling" }]);
    await tick(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    await tick(THREAD_POLL_MS * 5);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reads the whole page every few fast polls", async () => {
    setActiveCards([{ id: "c1", column: "running", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page({ items: [item("a"), item("b"), item("c")], total: 3 })]);
    await tick(THREAD_POLL_MS * WHOLE_PAGE_EVERY);
    const calls = fetchPage.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(WHOLE_PAGE_EVERY);
    expect(calls[0]).toBeUndefined();
    expect(calls.slice(1, -1).every((a) => a === 1)).toBe(true);
    expect(calls.at(-1)).toBeUndefined();
    stop();
  });

  it("reads the whole page after a whole board read", async () => {
    const { fetchPage, stop } = start([page({ items: [item("a"), item("b"), item("c")], total: 3 })]);
    await tick(THREAD_POLL_MS * 2);
    expect(fetchPage).toHaveBeenLastCalledWith(1);
    markWholeRead();
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenLastCalledWith(undefined);
    stop();
  });

  it("goes to the fast pace at once when a card is woken", async () => {
    setActiveCards([{ id: "c1", column: "review", cwd: "worker://w1/ling" }]);
    const { fetchPage, stop } = start([page()]);
    await tick(1_000);
    wakeCard("c1");
    await tick(THREAD_POLL_MS);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    wakeCard("c1");
    stop();
  });

  it("wakes a card the board hasn't seen, and knows its worker", () => {
    wakeCard("new");
    expect(isActiveCard("new")).toBe(true);
    expect(workerOfCard("new")).toBe("?");
    setActiveCards([{ id: "c1", column: "review", cwd: "worker://w9/ling" }]);
    expect(workerOfCard("c1")).toBe("w9");
    wakeCard("c1");
    expect(workerOfCard("c1")).toBe("w9");
  });
});

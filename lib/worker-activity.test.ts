import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "./game";
import type { Card } from "./types";

// Your workers' cards as activity: backfilled like a card this Mac never saw, read at most every five minutes, never
// holding the game up, and merged without counting a card twice.
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-worker-activity-test", listCards: () => [] }));

const { forgetWorkerActivity, mergeWorkerEvents, workerActivity, WORKER_ACTIVITY_TTL } = await import("./worker-activity");

const card = (id: string, over: Partial<Card> = {}): Card => ({ id, title: id, prompt: "", cwd: "worker://w1/app", backend: "claude", permissionMode: "default", column: "done", createdAt: 1_000, updatedAt: 5_000, turns: 3, ...over });

beforeEach(() => forgetWorkerActivity());
afterEach(() => vi.useRealTimers());

describe("workerActivity", () => {
  it("backfills each worker card: made, its turns and Done", async () => {
    const read = vi.fn(() => Promise.resolve({ cards: [card("w1"), card("cp", { role: "copilot" })] }));
    const events = await workerActivity(read, 0);
    expect(events.map((e) => e.id)).toEqual(["created:w1", "turns:w1", "done:w1"]);
    expect(events[1]).toMatchObject({ turns: 3, at: 5_000 });
  });

  it("reads again only after five minutes, and a failed read adds nothing", async () => {
    const read = vi.fn(() => Promise.reject(new Error("signed out")));
    expect(await workerActivity(read, 0)).toEqual([]);
    expect(await workerActivity(read, WORKER_ACTIVITY_TTL - 1)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    await workerActivity(read, WORKER_ACTIVITY_TTL);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers with nothing when the read is slow, and the next ask has it", async () => {
    vi.useFakeTimers();
    let land: (v: { cards: Card[] }) => void = () => {};
    const read = vi.fn(() => new Promise<{ cards: Card[] }>((resolve) => (land = resolve)));
    const first = workerActivity(read, 0, 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await first).toEqual([]);
    land({ cards: [card("w2", { column: "review", turns: 0, updatedAt: 1_000 })] });
    expect((await workerActivity(read, 1)).map((e) => e.id)).toEqual(["created:w2"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("mergeWorkerEvents", () => {
  const local: ActivityEvent[] = [{ id: "a", kind: "created", at: 2, card: "m1" }, { id: "q", kind: "quality", at: 2 }];

  it("adds the workers' events in time order, dropping any whose id or card the log has", () => {
    const remote: ActivityEvent[] = [
      { id: "created:w1", kind: "created", at: 1, card: "w1" },
      { id: "a", kind: "turn", at: 3 },
      { id: "done:m1", kind: "done", at: 4, card: "m1" },
    ];
    expect(mergeWorkerEvents(local, remote).map((e) => e.id)).toEqual(["created:w1", "a", "q"]);
  });

  it("hands the log back as it is when the workers add nothing", () => {
    expect(mergeWorkerEvents(local, [])).toBe(local);
    expect(mergeWorkerEvents(local, [{ id: "a", kind: "turn", at: 3 }])).toBe(local);
  });
});

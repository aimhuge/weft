import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "./game";
import type { Card } from "./types";

// Your workers' cards as activity: backfilled like a card this Mac never saw, read at most every five minutes, never
// holding the game up, and merged without counting a card twice.
vi.mock("./store", () => ({ DATA_DIR: "/tmp/weft-worker-activity-test", listCards: () => [] }));

const { forgetWorkerActivity, mergeWorkerEvents, multiDayCards, turnDays, workerActivity, workerEvents, WORKER_ACTIVITY_TTL } = await import("./worker-activity");
const { dayKey } = await import("./game");

// Local noon on a day of November 2026, so a turn's day is the same in any time zone the tests run in.
const day = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();

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

describe("a worker card's turns, by the day each ended", () => {
  const long = card("m", { createdAt: day(1), updatedAt: day(3, 18), lastActivity: day(3, 18), turns: 5, costUsd: 2 });

  it("reads the times only for cards that ran across days, and counts each day a turn ended", async () => {
    const one = card("s", { createdAt: day(2, 9), updatedAt: day(2, 15), turns: 2 });
    const turnTimes = vi.fn((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, [day(1), day(1, 14), day(3, 18)]]))));
    const events = await workerActivity(() => Promise.resolve({ cards: [long, one, card("cp", { role: "copilot", createdAt: day(1), updatedAt: day(4) })] }), 0, 3_000, turnTimes);
    expect(turnTimes).toHaveBeenCalledWith(["m"]);
    const turns = events.filter((e) => e.kind === "turn");
    expect(turns.map((e) => [e.id, dayKey(e.at), e.turns, e.cost])).toEqual([
      [`turns:m:${dayKey(day(1))}`, dayKey(day(1)), 2, undefined],
      ["turns:s", dayKey(day(2)), 2, undefined],
      // Two of its five turns left no time: they stay on its last active day, with the card's cost.
      [`turns:m:${dayKey(day(3))}`, dayKey(day(3)), 3, 2],
    ]);
  });

  it("falls back to the last active day when the times can't be read, and skips the read with no multi-day card", async () => {
    const events = await workerActivity(() => Promise.resolve({ cards: [long] }), 0, 3_000, () => Promise.reject(new Error("offline")));
    expect(events.find((e) => e.kind === "turn")).toMatchObject({ id: "turns:m", turns: 5 });
    forgetWorkerActivity();
    const turnTimes = vi.fn(() => Promise.resolve(new Map<string, number[]>()));
    await workerActivity(() => Promise.resolve({ cards: [card("s", { createdAt: day(2, 9), updatedAt: day(2, 15) })] }), 0, 3_000, turnTimes);
    expect(turnTimes).not.toHaveBeenCalled();
    // With no reader at all, the times are none.
    forgetWorkerActivity();
    expect((await workerActivity(() => Promise.resolve({ cards: [long] }), 0)).map((e) => e.id)).toContain("turns:m");
  });

  it("leaves out copilots and handed-off cards, and keeps a card with no times as it was", () => {
    expect(multiDayCards([long, card("cp", { role: "copilot", createdAt: day(1), updatedAt: day(3) }), card("h", { handedOff: { workerId: "w1", commandId: "c" }, createdAt: day(1), updatedAt: day(3) })])).toEqual(["m"]);
    expect(workerEvents([long], new Map([["other", [day(2)]]])).map((e) => e.id)).toEqual(["created:m", "turns:m", "done:m"]);
    expect(workerEvents([long], new Map())).toEqual(workerEvents([long], new Map()));
  });

  it("splits by day without a remainder when every turn has its time, and takes a later time on the last day", () => {
    const event = { id: "turns:x", kind: "turn" as const, at: day(2, 10), card: "x", turns: 2 };
    expect(turnDays(event, [day(1), day(2, 11)]).map((e) => [e.id, e.at, e.turns, e.cost])).toEqual([
      [`turns:x:${dayKey(day(1))}`, day(1), 1, undefined],
      [`turns:x:${dayKey(day(2))}`, day(2, 11), 1, undefined],
    ]);
    // More times than the card counts: each still counts. One missing turns field counts as one, and a later
    // remainder moves the day's time on.
    expect(turnDays({ ...event, turns: undefined, at: day(2, 20) }, [day(2, 8)]).map((e) => [e.at, e.turns])).toEqual([[day(2, 8), 1]]);
    expect(turnDays({ ...event, turns: 3, at: day(2, 20) }, [day(2, 8)]).map((e) => [e.at, e.turns])).toEqual([[day(2, 20), 3]]);
    // A remainder on a last active day no time fell on starts that day.
    expect(turnDays({ ...event, turns: 3, at: day(3) }, [day(1)]).map((e) => [dayKey(e.at), e.turns])).toEqual([[dayKey(day(1)), 1], [dayKey(day(3)), 2]]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateLoop, holdNote, type UpdateLoopDeps } from "./worker-update-loop";
import type { Tick } from "./worker-update";

function loop(over: Partial<UpdateLoopDeps> = {}) {
  const tick = vi.fn<(hold: () => boolean) => Promise<Tick>>((hold) => Promise.resolve(hold() ? { restart: false, note: null } : { restart: false, note: null, held: "abc1234" }));
  const update = { tick, restart: vi.fn() };
  const idle = vi.fn(() => true);
  const holders = vi.fn(() => [{ title: "Dark mode", asking: false }]);
  const show = vi.fn(() => Promise.resolve());
  const release = vi.fn();
  const log = vi.fn();
  const updates = createUpdateLoop({ update, idle, holders, show, release, log, minFetchMs: 1_000, firstFetchMs: 0, everyMs: 900_000, pushedEveryMs: 3_600_000, ...over });
  return { updates, tick, update, idle, holders, show, release, log };
}

describe("holdNote", () => {
  it("names the cards, the ones asking first, and counts the rest", () => {
    const cards = [{ title: "A", asking: false }, { title: "B", asking: true }, { title: "C", asking: false }, { title: "D", asking: false }, { title: "E", asking: false }];
    expect(holdNote("abc1234", cards)).toBe("Update to abc1234 is waiting for 5 cards: “B” (needs your answer), “A”, “C” and 2 more.");
  });

  it("shortens a long title and fits the column", () => {
    const cards = Array.from({ length: 9 }, () => ({ title: "x".repeat(500), asking: true }));
    expect(holdNote("abc1234", cards).length).toBeLessThanOrEqual(400);
  });

  it("says when nothing it can name is in the way", () => {
    expect(holdNote("abc1234", [])).toBe("Update to abc1234 is waiting for the worker to go idle.");
  });
});

describe("the update loop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks at once on a ping, then at most once a limit", async () => {
    const l = loop();
    l.updates.ping();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 50; i += 1) l.updates.ping();
    await vi.advanceTimersByTimeAsync(0);
    expect(l.tick).toHaveBeenCalledOnce();
  });

  it("keeps a ping inside the limit for when it ends, so a stranger's can't swallow a real push", async () => {
    const l = loop();
    l.updates.ping();
    await vi.advanceTimersByTimeAsync(0);
    l.updates.ping();
    await vi.advanceTimersByTimeAsync(999);
    expect(l.tick).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(l.tick).toHaveBeenCalledTimes(2);
  });

  it("looks again after a check that a ping landed during", async () => {
    let finish: (t: Tick) => void = () => {};
    const l = loop();
    l.tick.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    l.updates.ping();
    l.updates.ping();
    finish({ restart: false, note: null });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(l.tick).toHaveBeenCalledTimes(2);
  });

  it("waits out the health check before the first ping-driven fetch", async () => {
    const l = loop({ firstFetchMs: 120_000 });
    l.updates.up();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(l.tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(l.tick).toHaveBeenCalledOnce();
  });

  it("lets a request by hand past the limit", async () => {
    const l = loop();
    await l.updates.check();
    await l.updates.check();
    expect(l.tick).toHaveBeenCalledTimes(2);
  });

  it("goes as soon as the last holder ends, with no timer and no fetch before that", async () => {
    const l = loop();
    l.idle.mockReturnValue(false);
    await l.updates.check();
    expect(l.show).toHaveBeenCalledWith("Update to abc1234 is waiting for a card: “Dark mode”.");
    l.holders.mockReturnValue([{ title: "Other", asking: true }]);
    l.updates.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(l.tick).toHaveBeenCalledOnce();
    expect(l.show).toHaveBeenLastCalledWith("Update to abc1234 is waiting for a card: “Other” (needs your answer).");
    l.idle.mockReturnValue(true);
    l.updates.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(l.tick).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a change when nothing is held", async () => {
    const l = loop();
    l.updates.changed();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(l.tick).not.toHaveBeenCalled();
  });

  it("stops retrying when a held check fails, until the next one", async () => {
    const l = loop();
    l.idle.mockReturnValue(false);
    await l.updates.check();
    l.tick.mockRejectedValueOnce(new Error("no network"));
    await l.updates.check();
    expect(l.log).toHaveBeenCalledWith("Weft Worker: update check: no network");
    l.idle.mockReturnValue(true);
    l.updates.changed();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(l.tick).toHaveBeenCalledTimes(2);
  });

  it("releases the queue when an update stays put, and keeps it when restarting", async () => {
    const l = loop();
    await l.updates.check();
    expect(l.release).toHaveBeenCalledOnce();
    expect(l.updates.updating()).toBe(false);
    l.tick.mockImplementationOnce((hold) => Promise.resolve({ restart: hold(), note: null }));
    await l.updates.check();
    expect(l.update.restart).toHaveBeenCalledOnce();
    expect(l.updates.updating()).toBe(true);
    expect(l.release).toHaveBeenCalledOnce();
  });

  it("slows its timer while pings arrive and speeds up when they stop", async () => {
    const l = loop({ firstFetchMs: 10_000_000 });
    l.updates.start();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(l.tick).toHaveBeenCalledTimes(1);
    l.updates.up();
    l.updates.up();
    // One look on joining, for pings it missed, once the limit lets it.
    await vi.advanceTimersByTimeAsync(3_599_999);
    expect(l.tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(l.tick).toHaveBeenCalledTimes(3);
    l.updates.down();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(l.tick).toHaveBeenCalledTimes(4);
  });

  it("leaves nothing running after stop", async () => {
    const l = loop({ firstFetchMs: 1_000 });
    l.updates.start();
    l.updates.ping();
    l.updates.stop();
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(l.tick).not.toHaveBeenCalled();
  });
});

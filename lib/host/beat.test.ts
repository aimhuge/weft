import { afterEach, describe, expect, it, vi } from "vitest";
import { createBeat, SLOW_BEAT_MS, type BeatDeps } from "./beat";
import type { PresenceHooks } from "../worker-presence";
import type { WorkerStatus } from "../worker-registry";

afterEach(() => vi.useRealTimers());

function setup(over: Partial<BeatDeps> = {}, withPresence = true) {
  let clock = 0;
  let status: WorkerStatus = "online";
  let hooks: PresenceHooks = { up: () => {}, down: () => {} };
  const heartbeat = vi.fn<BeatDeps["heartbeat"]>(() => Promise.resolve());
  const after = vi.fn<BeatDeps["after"]>();
  const log = vi.fn();
  const track = vi.fn();
  const leave = vi.fn();
  const presence = vi.fn((h: PresenceHooks) => {
    hooks = h;
    return { track, leave };
  });
  const beat = createBeat({ heartbeat, status: () => status, after, log, now: () => clock, ...(withPresence ? { presence } : {}), ...over });
  return {
    beat,
    heartbeat,
    after,
    log,
    track,
    leave,
    hooks: () => hooks,
    set: (s: WorkerStatus) => (status = s),
    tick: (ms: number) => (clock += ms),
  };
}

describe("createBeat", () => {
  it("writes the row every tick with no presence socket", async () => {
    const t = setup({}, false);
    await t.beat.tick();
    await t.beat.tick();
    expect(t.heartbeat).toHaveBeenCalledTimes(2);
    expect(t.after).toHaveBeenLastCalledWith(true);
  });

  it("with the socket up, tracks and writes the row only every slow beat or on a change", async () => {
    const t = setup();
    t.beat.start();
    t.hooks().up();
    await vi.waitFor(() => expect(t.track).toHaveBeenCalledWith("online"));
    t.heartbeat.mockClear();
    t.tick(1000);
    await t.beat.tick();
    expect(t.heartbeat).not.toHaveBeenCalled();
    expect(t.track).toHaveBeenCalledTimes(1);
    expect(t.after).toHaveBeenLastCalledWith(true);
    t.set("busy");
    await t.beat.tick();
    expect(t.track).toHaveBeenLastCalledWith("busy");
    expect(t.heartbeat).toHaveBeenCalledWith("busy");
    t.heartbeat.mockClear();
    t.tick(SLOW_BEAT_MS);
    await t.beat.tick();
    expect(t.heartbeat).toHaveBeenCalledWith("busy");
    await t.beat.stop();
  });

  it("tracks again on the next tick when the server refused the track", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.track.mockResolvedValueOnce(false);
    t.beat.start();
    t.hooks().up();
    await vi.waitFor(() => expect(t.track).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.track).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.track).toHaveBeenCalledTimes(2);
    await t.beat.stop();
  });

  it("goes back to writing every tick when the socket drops, and re-tracks on a rejoin", async () => {
    const t = setup();
    t.beat.start();
    t.hooks().up();
    await vi.waitFor(() => expect(t.track).toHaveBeenCalledTimes(1));
    // Lets the writes the join queued land first.
    await t.beat.tick();
    t.hooks().down();
    t.heartbeat.mockClear();
    await t.beat.tick();
    await t.beat.tick();
    expect(t.heartbeat).toHaveBeenCalledTimes(2);
    t.hooks().up();
    await vi.waitFor(() => expect(t.track).toHaveBeenCalledTimes(2));
    await t.beat.stop();
  });

  it("logs a failed write and says it didn't land", async () => {
    const t = setup({}, false);
    t.heartbeat.mockRejectedValueOnce(new Error("no network"));
    await t.beat.tick();
    expect(t.log).toHaveBeenCalledWith("Weft Worker: heartbeat: no network");
    expect(t.after).toHaveBeenLastCalledWith(false);
  });

  it("ticks on its timer, and on the way out leaves the topic and writes offline", async () => {
    vi.useFakeTimers();
    const t = setup({ beatMs: 10 });
    t.beat.start();
    await vi.advanceTimersByTimeAsync(25);
    expect(t.after.mock.calls.length).toBeGreaterThanOrEqual(3);
    await t.beat.stop();
    expect(t.leave).toHaveBeenCalled();
    expect(t.heartbeat).toHaveBeenLastCalledWith("offline");
    const calls = t.after.mock.calls.length;
    await vi.advanceTimersByTimeAsync(50);
    expect(t.after.mock.calls.length).toBe(calls);
  });

  it("starts and stops with no presence and the default pace", async () => {
    vi.useFakeTimers();
    const t = setup({}, false);
    t.beat.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.heartbeat).toHaveBeenCalledTimes(2);
    await t.beat.stop();
  });

  it("keeps its own clock when none is handed in", async () => {
    const heartbeat = vi.fn(() => Promise.resolve());
    const beat = createBeat({ heartbeat, status: () => "online", after: vi.fn(), log: vi.fn() });
    await beat.tick();
    expect(heartbeat).toHaveBeenCalledWith("online");
  });

  it("writes offline only after an online still in flight, and never ticks after it", async () => {
    const t = setup({}, false);
    let release: () => void = () => {};
    const order: string[] = [];
    t.heartbeat.mockImplementationOnce(
      (s) =>
        new Promise<void>((done) => {
          release = () => {
            order.push(s);
            done();
          };
        }),
    );
    t.heartbeat.mockImplementation((s) => (order.push(s), Promise.resolve()));
    const late = t.beat.tick();
    await vi.waitFor(() => expect(t.heartbeat).toHaveBeenCalledTimes(1));
    const stopping = t.beat.stop();
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([late, stopping]);
    expect(order).toEqual(["online", "offline"]);
    await t.beat.tick();
    expect(order).toEqual(["online", "offline"]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";

// The daemon's loops: one poll, and the timers start() runs. Single commands are in worker-daemon.test.ts.
describe("polling", () => {
  it("runs everything it was given", async () => {
    const d = makeDeps();
    d.pending.mockResolvedValue([
      command({ id: "cmd-1" }),
      command({ id: "cmd-2", kind: "stop", payload: { cardId: "card-1" } as never }),
    ]);
    await d.daemon.poll();
    expect(d.claim).toHaveBeenCalledTimes(2);
    expect(d.stop).toHaveBeenCalledWith("card-1");
  });

  it("logs a failed poll instead of throwing", async () => {
    const d = makeDeps();
    d.pending.mockRejectedValue(new Error("offline"));
    await expect(d.daemon.poll()).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalledWith("Weft Worker: offline");
  });
});

describe("recovering after a restart", () => {
  it("publishes what it found before it resumes, and reads commands last", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.recover.mockReturnValue({ cut: ["a"], stopped: ["b"] });
    d.flush.mockImplementationOnce(() => (order.push("flush"), Promise.resolve()));
    d.resume.mockImplementation(() => void order.push("resume"));
    d.pending.mockImplementation(() => (order.push("poll"), Promise.resolve([])));
    const stop = d.daemon.start();
    await vi.waitFor(() => expect(order).toContain("poll"));
    await stop();
    expect(d.track).toHaveBeenCalledWith("a");
    expect(d.touch).toHaveBeenCalledWith("b");
    expect(order.slice(0, 3)).toEqual(["flush", "resume", "poll"]);
    expect(d.log).toHaveBeenCalledWith("Weft Worker: 1 turn(s) cut off by the last restart");
  });

  it("still reads commands when recovering fails", async () => {
    const d = makeDeps();
    d.recover.mockImplementation(() => {
      throw new Error("bad board");
    });
    const stop = d.daemon.start();
    await vi.waitFor(() => expect(d.pending).toHaveBeenCalled());
    await stop();
    expect(d.log).toHaveBeenCalledWith("Weft Worker: recovering cards: bad board");
    expect(d.resume).not.toHaveBeenCalled();
  });
});

describe("start", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("heartbeats, polls and flushes on timers", async () => {
    const d = makeDeps();
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.heartbeat).toHaveBeenCalledWith("online");
    expect(d.pending).toHaveBeenCalled();
    d.heartbeat.mockClear();
    d.pending.mockClear();
    d.flush.mockClear();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(d.pending).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(d.heartbeat).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.flush).toHaveBeenCalled();
    await stop();
  });

  it("heartbeats busy only while a session is really running", async () => {
    const d = makeDeps();
    d.live.mockReturnValue(true);
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.heartbeat).toHaveBeenCalledWith("busy");
    await stop();
  });

  it("logs a failed heartbeat instead of throwing", async () => {
    const d = makeDeps();
    d.heartbeat.mockRejectedValue(new Error("no network"));
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.log).toHaveBeenCalledWith("Weft Worker: heartbeat: no network");
    await stop();
  });

  it("stops the timers, flushes and says the worker is offline", async () => {
    const d = makeDeps();
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    d.heartbeat.mockClear();
    d.flush.mockClear();
    await stop();
    expect(d.flush).toHaveBeenCalled();
    expect(d.heartbeat).toHaveBeenCalledWith("offline");
    d.pending.mockClear();
    d.heartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.pending).not.toHaveBeenCalled();
    expect(d.heartbeat).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LimitSample } from "./limit-chart";
import { startWorkerLimits } from "./worker-limits";

// The daemon's limits: the poll started, and the history published when it grew.
afterEach(() => vi.useRealTimers());

const sample = (at: number, used = 10): LimitSample => ({ at, backend: "claude", kind: "five_hour", used });

describe("startWorkerLimits", () => {
  it("starts the poll, publishes the history a minute in, then only when it changed", async () => {
    vi.useFakeTimers();
    const history = [sample(60_000)];
    const setLimits = vi.fn(() => Promise.resolve());
    const poll = vi.fn();
    const limits = startWorkerLimits({ poll, read: () => history, setLimits, log: vi.fn() });
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(setLimits).toHaveBeenCalledWith({ v: 1, s: [[1, "claude", 5, 10, 0]] });
    expect(await limits.publish()).toBe(false);
    history.push(sample(120_000, 20));
    expect(await limits.publish()).toBe(true);
    expect(setLimits).toHaveBeenCalledTimes(2);
    // Every five minutes after that, when it grew.
    history.push(sample(150_000, 25));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(setLimits).toHaveBeenCalledTimes(3);
    limits.stop();
    history.push(sample(180_000, 30));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(setLimits).toHaveBeenCalledTimes(3);
  });

  it("publishes the models at their cap with the history, and again when they change", async () => {
    const capped = [{ model: "claude-opus-5-5", at: 60_000, resetsAt: 1_800_000_000_000 }];
    const models = vi.fn(() => capped);
    const setLimits = vi.fn(() => Promise.resolve());
    const limits = startWorkerLimits({ poll: vi.fn(), read: () => [], models, setLimits, log: vi.fn(), firstMs: 1e9, everyMs: 1e9 });
    expect(await limits.publish()).toBe(true);
    expect(setLimits).toHaveBeenCalledWith({ v: 1, s: [], m: [["claude-opus-5-5", 1, 1_800_000_000]] });
    expect(await limits.publish()).toBe(false);
    models.mockReturnValue([]);
    expect(await limits.publish()).toBe(false);
    models.mockReturnValue([{ ...capped[0]!, resetsAt: 1_800_000_060_000 }]);
    expect(await limits.publish()).toBe(true);
    limits.stop();
  });

  it("publishes nothing with no history, and logs a failure once, trying again next time", async () => {
    const log = vi.fn();
    const setLimits = vi.fn(() => Promise.reject(new Error("no column")));
    const read = vi.fn((): LimitSample[] => []);
    const limits = startWorkerLimits({ poll: vi.fn(), read, setLimits, log, firstMs: 1e9, everyMs: 1e9 });
    expect(await limits.publish()).toBe(false);
    expect(setLimits).not.toHaveBeenCalled();
    read.mockReturnValue([sample(60_000)]);
    expect(await limits.publish()).toBe(false);
    expect(await limits.publish()).toBe(false);
    expect(setLimits).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Weft Worker: publishing its limits: no column");
    limits.stop();
  });
});

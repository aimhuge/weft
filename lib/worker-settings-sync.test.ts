import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsSync, type SyncedRow } from "./worker-settings-sync";

// A worker mirrors its owner's synced settings: at start, every minute and when a command arrives, never in front
// of a turn, and only when the row changed.
afterEach(() => vi.useRealTimers());

function setup(rows: (SyncedRow | null | Error)[], changed: string[] = ["pushOnDone"]) {
  const read = vi.fn(() => {
    const next = rows.length > 1 ? rows.shift() : rows[0];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? null);
  });
  const apply = vi.fn(() => changed);
  const log = vi.fn();
  let now = 0;
  const sync = createSettingsSync({ read, apply, log, everyMs: 60_000, gapMs: 15_000, now: () => now });
  return { sync, read, apply, log, tick: (ms: number) => (now += ms) };
}

describe("createSettingsSync", () => {
  it("applies a row once, and again only when it changed", async () => {
    const a = { settings: { pushOnDone: false }, updated_at: "t1" };
    const { sync, apply, log } = setup([a, a, { settings: { pushOnDone: true }, updated_at: "t2" }]);
    await sync.sync();
    await sync.sync();
    await sync.sync();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith({ pushOnDone: true });
    expect(log).toHaveBeenCalledWith("Weft Worker: your settings changed: pushOnDone");
  });

  it("says nothing when nothing changed, and leaves settings alone when the owner has none", async () => {
    const { sync, apply, log } = setup([null]);
    await sync.sync();
    expect(apply).not.toHaveBeenCalled();
    const quiet = setup([{ settings: {}, updated_at: "t" }], []);
    await quiet.sync.sync();
    expect(quiet.log).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs a failed read once and keeps trying", async () => {
    const { sync, log, apply } = setup([new Error("offline"), new Error("offline"), { settings: {}, updated_at: "t" }]);
    await sync.sync();
    await sync.sync();
    await sync.sync();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenNthCalledWith(1, "Weft Worker: reading your settings: offline");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("shares one read between two asks, and a nudge reads at most every 15 s", async () => {
    const { sync, read, tick } = setup([{ settings: {}, updated_at: "t" }]);
    await Promise.all([sync.sync(), sync.sync()]);
    expect(read).toHaveBeenCalledTimes(1);
    sync.nudge();
    expect(read).toHaveBeenCalledTimes(1);
    tick(15_000);
    sync.nudge();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads at start and every minute until stopped", async () => {
    vi.useFakeTimers();
    const { sync, read } = setup([{ settings: {}, updated_at: "t" }]);
    const stop = sync.start();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

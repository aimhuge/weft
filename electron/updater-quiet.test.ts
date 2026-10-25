// A ready update installs itself once nothing runs and nobody's at the Mac, and its notification can restart now.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAY_SECONDS, QUIET_CHECK_MS } from "./updater.cjs";
import { make } from "./updater.fixtures";

afterEach(() => vi.useRealTimers());

describe("quiet install", () => {
  it("the ready notification's button restarts through install, and a click opens the window", async () => {
    const openWindow = vi.fn();
    const { updater, squirrel, notify, onBeforeInstall } = make({ openWindow, countRunning: () => Promise.resolve(0) });
    await updater.check();
    squirrel.emit("update-downloaded");
    const [, , on] = notify.mock.calls[0] as [string, string, { install: () => Promise<boolean>; open: () => void }];
    expect(on.open).toBe(openWindow);
    expect(await on.install()).toBe(true);
    expect(onBeforeInstall).toHaveBeenCalled();
    expect(squirrel.quitAndInstall).toHaveBeenCalled();
    updater.stop();
  });

  it("installs a ready update on its own once nothing runs and nobody's at the Mac", async () => {
    let idle = 0;
    let running: number | null = 2;
    const { updater, squirrel } = make({ idleSeconds: () => idle, countRunning: () => Promise.resolve(running) });
    expect(await updater.installWhenQuiet()).toBe(false); // nothing ready yet
    await updater.check();
    squirrel.emit("update-downloaded");
    expect(await updater.installWhenQuiet()).toBe(false); // someone's at the Mac
    idle = AWAY_SECONDS;
    expect(await updater.installWhenQuiet()).toBe(false); // threads still running
    running = null;
    expect(await updater.installWhenQuiet()).toBe(false); // an unknown count is busy
    running = 0;
    expect(await updater.installWhenQuiet()).toBe(true);
    expect(squirrel.quitAndInstall).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it("a failed running count never installs on its own", async () => {
    const countRunning = () => Promise.reject(new Error("403"));
    const { updater, squirrel } = make({ idleSeconds: () => AWAY_SECONDS, countRunning });
    await updater.check();
    squirrel.emit("update-downloaded");
    expect(await updater.installWhenQuiet()).toBe(false);
    expect(squirrel.quitAndInstall).not.toHaveBeenCalled();
    updater.stop();
  });

  it("checks for a quiet moment every minute once an update is ready, until stopped", async () => {
    vi.useFakeTimers();
    let idle = 0;
    const { updater, squirrel } = make({ idleSeconds: () => idle, countRunning: () => Promise.resolve(0) });
    await updater.check();
    squirrel.emit("update-downloaded");
    squirrel.emit("update-downloaded"); // a second download doesn't double the watch
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS);
    expect(squirrel.quitAndInstall).not.toHaveBeenCalled();
    idle = AWAY_SECONDS + 1;
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS);
    expect(squirrel.quitAndInstall).toHaveBeenCalledTimes(1);
    updater.stop();
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS * 3);
    expect(squirrel.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

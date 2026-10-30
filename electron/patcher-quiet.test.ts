import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAY_SECONDS, CHECK_EVERY_MS, FIRST_CHECK_MS, PATCH_FEED, QUIET_CHECK_MS } from "./patcher.cjs";
import { make } from "./patcher.fixtures";

afterEach(() => {
  vi.useRealTimers();
});

describe("createPatcher.applyWhenQuiet", () => {
  it("doesn't apply when the Mac hasn't been idle long enough", async () => {
    const { patcher, applyNow } = make({ idleSeconds: vi.fn(() => AWAY_SECONDS - 1) });
    await patcher.check();
    expect(await patcher.applyWhenQuiet()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("doesn't apply when a thread runs", async () => {
    const { patcher, applyNow } = make({ countRunning: vi.fn(() => Promise.resolve(1)) });
    await patcher.check();
    expect(await patcher.applyWhenQuiet()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("doesn't apply when the server can't say what's running", async () => {
    const { patcher, applyNow } = make({ countRunning: vi.fn(() => Promise.reject(new Error("server down"))) });
    await patcher.check();
    expect(await patcher.applyWhenQuiet()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("doesn't apply when no patch is ready", async () => {
    const { patcher, applyNow } = make();
    expect(await patcher.applyWhenQuiet()).toBe(false);
    expect(applyNow).not.toHaveBeenCalled();
  });

  it("applies when the Mac has been away and nothing runs", async () => {
    const { patcher, applyNow } = make();
    await patcher.check();
    expect(await patcher.applyWhenQuiet()).toBe(true);
    expect(applyNow).toHaveBeenCalledTimes(1);
    expect(patcher.state()).toMatchObject({ phase: "idle", applied: "0.6.7+abc123" });
  });
});

describe("createPatcher.start", () => {
  it("checks on a timer, only when packaged and keyed", async () => {
    vi.useFakeTimers();
    const fetchJson = vi.fn(() => Promise.resolve(null));
    const dev = make({ packaged: false, fetchJson });
    dev.patcher.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).not.toHaveBeenCalled();

    const noKey = make({ publicKey: null, fetchJson });
    noKey.patcher.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).not.toHaveBeenCalled();

    const app = make({ fetchJson });
    app.patcher.start();
    app.patcher.start(); // a second start doesn't double the timer
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    app.patcher.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("watches for a quiet moment once a patch is ready", async () => {
    vi.useFakeTimers();
    const applyNow = vi.fn(() => Promise.resolve());
    const { patcher } = make({ applyNow, idleSeconds: vi.fn(() => AWAY_SECONDS) });
    await patcher.check();
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS);
    expect(applyNow).toHaveBeenCalledTimes(1);
    patcher.stop();
  });

  it("keeps one quiet watcher, however many patches come by", async () => {
    vi.useFakeTimers();
    const applyNow = vi.fn(() => Promise.resolve());
    const { patcher } = make({ applyNow, idleSeconds: vi.fn(() => AWAY_SECONDS) });
    await patcher.check();
    await patcher.applyWhenQuiet(); // the switch puts it back to idle, so a second check can run
    await patcher.check();
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS);
    expect(applyNow).toHaveBeenCalledTimes(2); // once from each check, not once per watcher
    patcher.stop();
  });

  it("keeps ticking when a check throws", async () => {
    vi.useFakeTimers();
    const fetchJson = vi.fn(() => Promise.reject(new Error("offline")));
    const { patcher } = make({ fetchJson });
    patcher.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    patcher.stop();
  });

  it("keeps ticking when a check blows up", async () => {
    vi.useFakeTimers();
    const fetchJson = vi.fn(() => Promise.resolve(null));
    const { patcher } = make({
      fetchJson,
      busy: vi.fn(() => {
        throw new Error("no");
      }),
    });
    patcher.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    expect(fetchJson).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fetchJson).not.toHaveBeenCalled();
    patcher.stop();
  });

  it("keeps watching when the quiet check blows up", async () => {
    vi.useFakeTimers();
    const idleSeconds = vi.fn(() => {
      throw new Error("no screen");
    });
    const { patcher } = make({ idleSeconds });
    await patcher.check();
    await vi.advanceTimersByTimeAsync(QUIET_CHECK_MS);
    expect(idleSeconds).toHaveBeenCalled();
    patcher.stop();
  });
});

describe("patcher's feed", () => {
  it("points at the rolling patch-latest release", () => {
    expect(PATCH_FEED).toBe("https://github.com/aimhuge/weft/releases/download/patch-latest/patch.json");
  });
});

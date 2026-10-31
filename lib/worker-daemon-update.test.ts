import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";
import type { Tick } from "./worker-update";

function fakeUpdate(result: Tick = { restart: false, note: null }) {
  const tick = vi.fn<(hold: () => boolean) => Promise<Tick>>((hold) => Promise.resolve(hold() ? result : { restart: false, note: "waiting" }));
  return { tick, build: vi.fn(() => Promise.resolve("0.6.6+abc1234")), healthy: vi.fn(), restart: vi.fn() };
}

describe("the daemon's updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("restarts into a new build and takes no more work", async () => {
    const update = fakeUpdate({ restart: true, note: null });
    const d = makeDeps({ update });
    await d.daemon.checkForUpdate();
    expect(update.restart).toHaveBeenCalledOnce();
    d.pending.mockClear();
    await d.daemon.poll();
    expect(d.pending).not.toHaveBeenCalled();
  });

  it("waits while a turn is live, and says so on the row", async () => {
    const update = fakeUpdate();
    const d = makeDeps({ update });
    d.live.mockReturnValue(true);
    await d.daemon.checkForUpdate();
    expect(update.restart).not.toHaveBeenCalled();
    expect(d.setBuild).toHaveBeenCalledWith("0.6.6+abc1234", "waiting");
  });

  it("isn't idle during a clone", async () => {
    let finish = () => {};
    const clone = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const update = fakeUpdate({ restart: true, note: null });
    const d = makeDeps({ update, clone });
    d.pending.mockResolvedValueOnce([command({ kind: "clone", payload: { repo: "https://github.com/a/b.git" } })]);
    await d.daemon.poll();
    await vi.advanceTimersByTimeAsync(0);
    await d.daemon.checkForUpdate();
    expect(update.restart).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await d.daemon.checkForUpdate();
    expect(update.restart).toHaveBeenCalledOnce();
  });

  it("takes work again when the update stays put", async () => {
    const d = makeDeps({ update: fakeUpdate({ restart: false, note: "Skipping abc: it doesn't load." }) });
    await d.daemon.checkForUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.setBuild).toHaveBeenCalledWith("0.6.6+abc1234", "Skipping abc: it doesn't load.");
    d.pending.mockClear();
    await d.daemon.poll();
    expect(d.pending).toHaveBeenCalled();
  });

  it("logs a failed check and reports each line once", async () => {
    const update = fakeUpdate();
    const d = makeDeps({ update });
    await d.daemon.checkForUpdate();
    await vi.advanceTimersByTimeAsync(0);
    await d.daemon.checkForUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.setBuild).toHaveBeenCalledOnce();
    update.tick.mockRejectedValueOnce(new Error("no network"));
    await d.daemon.checkForUpdate();
    expect(d.setBuild).toHaveBeenCalledOnce();
    expect(d.log).toHaveBeenCalledWith("Weft Worker: update check: no network");
  });

  it("clears the trial on a beat once it has stayed up", async () => {
    const update = fakeUpdate();
    const d = makeDeps({ update, beatMs: 10, healthyMs: 25 });
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(15);
    expect(update.healthy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(update.healthy).toHaveBeenCalled();
    await stop();
  });
});

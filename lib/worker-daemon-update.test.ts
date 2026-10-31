import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";
import type { Tick } from "./worker-update";
import type { WakeHooks } from "./worker-wake";

function fakeUpdate(result: Tick = { restart: false, note: null }) {
  const tick = vi.fn<(hold: () => boolean) => Promise<Tick>>((hold) => Promise.resolve(hold() ? result : { restart: false, note: null, held: "abc1234" }));
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
    d.holding.mockReturnValue([{ title: "Dark mode", asking: true }]);
    await d.daemon.checkForUpdate();
    expect(d.setBuild).toHaveBeenLastCalledWith("0.6.6+abc1234", "Update to abc1234 is waiting for a card: “Dark mode” (needs your answer).");
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

describe("the update command", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports before it holds, and the hold doesn't read its own pass as busy", async () => {
    const update = fakeUpdate({ restart: true, note: null });
    const d = makeDeps({ update });
    d.pending.mockResolvedValueOnce([command({ kind: "update", folder: "-", payload: {} })]);
    await d.daemon.poll();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.report).toHaveBeenCalledWith("cmd-1", "done", null, null);
    expect(d.report.mock.invocationCallOrder[0]).toBeLessThan(update.restart.mock.invocationCallOrder[0] ?? 0);
  });

  it("fails on a worker that doesn't update itself", async () => {
    const d = makeDeps();
    d.pending.mockResolvedValueOnce([command({ kind: "update", folder: "-", payload: {} })]);
    await d.daemon.poll();
    expect(d.report).toHaveBeenCalledWith("cmd-1", "failed", null, expect.stringContaining("doesn't update itself"));
  });
});

describe("the daemon's push pings", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes the moment a card ends, and leaves the topics on stop", async () => {
    const update = fakeUpdate();
    let hooks: WakeHooks | undefined;
    let cardChanged = () => {};
    const leave = vi.fn();
    const unsubscribe = vi.fn();
    const listenForPushes = (h: WakeHooks) => {
      hooks = h;
      return leave;
    };
    const onCardChange = (listener: () => void) => {
      cardChanged = listener;
      return unsubscribe;
    };
    const d = makeDeps({ update, listenForPushes, onCardChange, firstFetchMs: 0 });
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    d.live.mockReturnValue(true);
    hooks?.up();
    await vi.advanceTimersByTimeAsync(0);
    expect(update.tick).toHaveBeenCalledOnce();
    d.live.mockReturnValue(false);
    cardChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(update.tick).toHaveBeenCalledTimes(2);
    await stop();
    expect(leave).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

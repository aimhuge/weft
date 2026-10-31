import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { command, makeDeps } from "./worker-daemon.harness";
import type { WakeHooks } from "./worker-wake";

// A socket the test drives: it hands the hooks out and records the leave.
function socket() {
  const held: { hooks?: WakeHooks } = {};
  const leave = vi.fn();
  const listen = vi.fn((hooks: WakeHooks) => {
    held.hooks = hooks;
    return leave;
  });
  return { held, leave, listen };
}

describe("the daemon's wake-ups", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function started(over: Parameters<typeof makeDeps>[0] = {}) {
    const s = socket();
    const d = makeDeps({ listen: s.listen, ...over });
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    d.pending.mockClear();
    return { ...d, ...s, hooks: s.held.hooks as WakeHooks, stop };
  }

  it("keeps the 3 s poll until the socket joins", async () => {
    const d = await started();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(d.pending).toHaveBeenCalledTimes(3);
    await d.stop();
  });

  it("keeps the 3 s poll with no socket at all", async () => {
    const d = makeDeps();
    const stop = d.daemon.start();
    await vi.advanceTimersByTimeAsync(0);
    d.pending.mockClear();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(d.pending).toHaveBeenCalledTimes(3);
    await stop();
  });

  it("asks once on joining, for pings it missed, then only every 30 s", async () => {
    const d = await started();
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.pending).toHaveBeenCalledTimes(2);
    await d.stop();
  });

  it("asks at once on a ping", async () => {
    const d = await started();
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(0);
    d.pending.mockClear();
    d.hooks.ping();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await d.stop();
  });

  it("goes back to the fast poll when the socket drops, and slows again when it rejoins", async () => {
    const d = await started();
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(0);
    d.pending.mockClear();
    d.hooks.down();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(d.pending).toHaveBeenCalledTimes(3);
    d.pending.mockClear();
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await d.stop();
  });

  it("doesn't restart the fast poll on a repeated down, so a flapping socket can't starve it", async () => {
    const d = await started();
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(0);
    d.hooks.down();
    d.pending.mockClear();
    await vi.advanceTimersByTimeAsync(2_000);
    d.hooks.down();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await d.stop();
  });

  it("takes the pace from its deps", async () => {
    const d = await started({ slowPollMs: 5_000 });
    d.hooks.up();
    await vi.advanceTimersByTimeAsync(0);
    d.pending.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(d.pending).toHaveBeenCalledTimes(1);
    await d.stop();
  });

  it("leaves the socket and stops polling on the way out", async () => {
    const d = await started();
    d.hooks.up();
    await d.stop();
    expect(d.leave).toHaveBeenCalledOnce();
    d.pending.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.pending).not.toHaveBeenCalled();
  });

  it("leaves the heartbeat at 20 s whatever the socket does", async () => {
    const d = await started();
    d.hooks.up();
    d.heartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.heartbeat).toHaveBeenCalledTimes(3);
    await d.stop();
  });
});

describe("a ping during a poll", () => {
  it("doesn't poll twice at once", async () => {
    const d = makeDeps();
    const gate: { release?: () => void } = {};
    d.pending.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve([]);
        }),
    );
    const first = d.daemon.poll();
    await d.daemon.poll();
    expect(d.pending).toHaveBeenCalledTimes(1);
    gate.release?.();
    await vi.waitFor(() => expect(d.pending).toHaveBeenCalledTimes(2));
    gate.release?.();
    await first;
  });

  it("asks again after a pass when a ping came during it, so a command that pass missed isn't left for the slow poll", async () => {
    const d = makeDeps();
    const late = command({ id: "cmd-late" });
    const gate: { release?: () => void } = {};
    d.pending.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve([]);
        }),
    );
    d.pending.mockResolvedValueOnce([late]);
    const first = d.daemon.poll();
    void d.daemon.poll();
    gate.release?.();
    await first;
    expect(d.claim).toHaveBeenCalledWith("cmd-late");
  });

  it("carries on with the pass it owes after one that failed", async () => {
    const d = makeDeps();
    const gate: { fail?: () => void } = {};
    d.pending.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          gate.fail = () => reject(new Error("no network"));
        }),
    );
    const first = d.daemon.poll();
    void d.daemon.poll();
    gate.fail?.();
    await first;
    expect(d.pending).toHaveBeenCalledTimes(2);
    await d.daemon.poll();
    expect(d.pending).toHaveBeenCalledTimes(3);
  });
});

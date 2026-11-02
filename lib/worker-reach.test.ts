import { afterEach, describe, expect, it, vi } from "vitest";

const tunnels = vi.hoisted(() => ({
  closeLeftovers: vi.fn(() => Promise.resolve()),
  closeTunnel: vi.fn(() => Promise.resolve()),
  listTunnels: vi.fn(() => [{ id: "t1", name: "localhost:3000" }, { id: "t2", name: "localhost:4000" }]),
}));
const publish = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const setMacLink = vi.hoisted(() => vi.fn());
vi.mock("./tunnels", () => tunnels);
vi.mock("./worker-dev-servers", () => ({ createDevPublisher: vi.fn(() => publish) }));
vi.mock("./worker-mac-ask", () => ({ setMacLink }));

const { startWorkerReach } = await import("./worker-reach");
const reg = { macAsk: vi.fn(), deviceResult: vi.fn(), deviceCancel: vi.fn(), tunnelOpen: vi.fn(), tunnelClose: vi.fn(), setDevServers: vi.fn() };

afterEach(() => vi.useRealTimers());

describe("startWorkerReach", () => {
  it("links the Mac, tidies leftovers, publishes dev servers on a timer, and closes its tunnels on the way out", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const stop = startWorkerReach(reg, log, 1_000);
    expect(setMacLink).toHaveBeenCalledWith({ ask: reg.macAsk, result: reg.deviceResult, cancel: reg.deviceCancel, tunnelOpen: reg.tunnelOpen, tunnelClose: reg.tunnelClose });
    expect(tunnels.closeLeftovers).toHaveBeenCalledWith(log);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(publish).toHaveBeenCalledTimes(2);
    tunnels.closeTunnel.mockRejectedValueOnce(new Error("offline"));
    await stop();
    expect(tunnels.closeTunnel.mock.calls).toEqual([["t1"], ["t2"]]);
    expect(log).toHaveBeenCalledWith("Tunnel localhost:3000: offline");
    vi.advanceTimersByTime(5_000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("logs to the console by default", () => {
    void startWorkerReach(reg)();
    expect(tunnels.closeLeftovers).toHaveBeenCalled();
  });
});

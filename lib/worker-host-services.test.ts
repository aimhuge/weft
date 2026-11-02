import { describe, expect, it, vi } from "vitest";

// What a worker runs beside its inbox: the settings sync and the limits, wired to its registry.
vi.mock("./host-settings", () => ({ applyAccountSettings: vi.fn(() => []) }));
vi.mock("./limit-history", () => ({ readSamples: vi.fn(() => [{ at: 60_000, backend: "claude", kind: "five_hour", used: 5 }]) }));
vi.mock("./limit-poll", () => ({ startLimitPoll: vi.fn() }));

const poll = await import("./limit-poll");
const host = await import("./host-settings");
const { startHostServices } = await import("./worker-host-services");

describe("startHostServices", () => {
  it("reads your settings at once, starts the limit poll, and stops both", async () => {
    vi.useFakeTimers();
    const reg = { accountSettings: vi.fn(() => Promise.resolve({ settings: { pushOnDone: false }, updated_at: "t" })), setLimits: vi.fn(() => Promise.resolve()) };
    const services = startHostServices(reg, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.accountSettings).toHaveBeenCalledTimes(1);
    expect(host.applyAccountSettings).toHaveBeenCalledWith({ pushOnDone: false });
    expect(poll.startLimitPoll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reg.setLimits).toHaveBeenCalledWith({ v: 1, s: [[1, "claude", 5, 5, 0]] });
    services.nudge();
    services.stop();
    const calls = reg.accountSettings.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reg.accountSettings).toHaveBeenCalledTimes(calls);
    vi.useRealTimers();
  });
});

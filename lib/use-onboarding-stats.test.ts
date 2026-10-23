// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The welcome's "started" and step stats (lib/use-onboarding-stats.ts), with trackOnboarding faked.

vi.mock("./telemetry-client", () => ({ trackOnboarding: vi.fn() }));
const { trackOnboarding } = await import("./telemetry-client");
const { useOnboardingStats } = await import("./use-onboarding-stats");

type Props = Parameters<typeof useOnboardingStats>[0];
const shown = { projects: [{}] };

beforeEach(() => vi.clearAllMocks());

describe("useOnboardingStats", () => {
  it("sends started once the CLI check is in, then each step", () => {
    const initialProps: Props = { preview: shown, replay: false, step: "ready", cliReady: null };
    const { rerender } = renderHook((p: Props) => useOnboardingStats(p), { initialProps });
    expect(trackOnboarding).not.toHaveBeenCalled();
    rerender({ preview: shown, replay: false, step: "ready", cliReady: true });
    expect(trackOnboarding).toHaveBeenCalledWith("onboarding_started", { has_history: true, cli_ready: true, replay: false });
    rerender({ preview: shown, replay: false, step: "projects", cliReady: true });
    expect(trackOnboarding).toHaveBeenLastCalledWith("onboarding_step", { step: "projects", seconds_on_last: 0 });
    expect(trackOnboarding).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while closed, and starts again on the next showing", () => {
    const initialProps: Props = { preview: null, replay: false, step: "ready", cliReady: true };
    const { rerender } = renderHook((p: Props) => useOnboardingStats(p), { initialProps });
    expect(trackOnboarding).not.toHaveBeenCalled();
    rerender({ preview: { projects: [] }, replay: true, step: "ready", cliReady: false });
    expect(trackOnboarding).toHaveBeenCalledWith("onboarding_started", { has_history: false, cli_ready: false, replay: true });
    rerender({ preview: null, replay: true, step: "ready", cliReady: false });
    rerender({ preview: { projects: [] }, replay: true, step: "ready", cliReady: false });
    expect(trackOnboarding).toHaveBeenCalledTimes(2);
  });
});

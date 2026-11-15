// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Weft's two sign-in asks' stats (lib/use-signin-ask-stats.ts), with trackOnboarding faked.

vi.mock("./telemetry-client", () => ({ trackOnboarding: vi.fn() }));
const { trackOnboarding } = await import("./telemetry-client");
const { useSignInAskStats } = await import("./use-signin-ask-stats");

type Props = { signedOut: boolean | null };
const mount = (signedOut: boolean | null) =>
  renderHook((p: Props) => useSignInAskStats("welcome", p.signedOut), { initialProps: { signedOut } });

beforeEach(() => vi.clearAllMocks());

describe("useSignInAskStats", () => {
  it("waits for the account, then sends shown once and completed when you sign in", () => {
    const { rerender } = mount(null);
    expect(trackOnboarding).not.toHaveBeenCalled();
    rerender({ signedOut: true });
    rerender({ signedOut: true });
    expect(trackOnboarding).toHaveBeenCalledWith("signin_ask_shown", { where: "welcome" });
    rerender({ signedOut: false });
    rerender({ signedOut: true });
    rerender({ signedOut: false });
    expect(trackOnboarding).toHaveBeenLastCalledWith("signin_ask_completed", { where: "welcome" });
    expect(trackOnboarding).toHaveBeenCalledTimes(2);
  });

  it("sends nothing for someone already signed in", () => {
    const { result } = mount(false);
    result.current.declined();
    expect(trackOnboarding).not.toHaveBeenCalled();
  });

  it("sends clicked, and declined only before signing in", () => {
    const { result, rerender } = mount(true);
    result.current.clicked();
    result.current.declined();
    expect(trackOnboarding).toHaveBeenCalledWith("signin_ask_clicked", { where: "welcome" });
    expect(trackOnboarding).toHaveBeenLastCalledWith("signin_ask_declined", { where: "welcome", never: false });
    rerender({ signedOut: false });
    vi.clearAllMocks();
    result.current.declined(true);
    expect(trackOnboarding).not.toHaveBeenCalled();
  });
});

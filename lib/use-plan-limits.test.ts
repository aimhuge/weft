// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS_POLL_MS, resetPlans, usePlanLimits } from "./use-plan-limits";

const PLANS = { claude: { at: 1, fiveHour: { used: 20 } } };

function respond(body: unknown, ok = true) {
  return vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response));
}

beforeEach(() => {
  resetPlans();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePlanLimits", () => {
  it("loads every CLI's plan with the board's token", async () => {
    const fetch = respond({ plans: PLANS });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => usePlanLimits());
    await waitFor(() => expect(result.current).toEqual(PLANS));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/limits/plans");
    expect(new Headers(init.headers).get("x-weft-token")).toBe("1");
  });

  it("stays null where the route refuses or fails", async () => {
    const refused = respond({}, false);
    vi.stubGlobal("fetch", refused);
    const { result, unmount } = renderHook(() => usePlanLimits());
    await waitFor(() => expect(refused).toHaveBeenCalled());
    expect(result.current).toBeNull();
    unmount();
    const broken = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", broken);
    const again = renderHook(() => usePlanLimits());
    await waitFor(() => expect(broken).toHaveBeenCalled());
    expect(again.result.current).toBeNull();
  });

  it("reads again each minute, and when the refresh key changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = respond({ plans: PLANS });
    vi.stubGlobal("fetch", fetch);
    const { rerender } = renderHook(({ key }) => usePlanLimits(key), { initialProps: { key: undefined as string | undefined } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => {
      vi.advanceTimersByTime(PLANS_POLL_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    rerender({ key: "new reading" });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("shares one load between strips and stops polling when the last one goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = respond({ plans: PLANS });
    vi.stubGlobal("fetch", fetch);
    const a = renderHook(() => usePlanLimits());
    const b = renderHook(() => usePlanLimits());
    await waitFor(() => expect(b.result.current).toEqual(PLANS));
    expect(fetch).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
    act(() => {
      vi.advanceTimersByTime(PLANS_POLL_MS * 2);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

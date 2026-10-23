// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS_POLL_MS, resetPlans, useLimitedModels, usePlanLimits } from "./use-plan-limits";

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

describe("useLimitedModels", () => {
  // The models that hit their own cap (lib/model-limit.ts) come with the plans, so the pickers mark them
  // without reading the store off disk: a client component can't import lib/model-limit.ts (2026-10-24).
  it("reads the models that hit their cap from the plans route", async () => {
    const models = [{ model: "claude-opus-5-5", at: 1, resetsAt: 2 }];
    vi.stubGlobal("fetch", respond({ plans: PLANS, models }));
    const { result } = renderHook(() => useLimitedModels());
    await waitFor(() => expect(result.current).toEqual(models));
  });

  it("is empty when the route sends none, or refuses", async () => {
    vi.stubGlobal("fetch", respond({ plans: PLANS }));
    const { result } = renderHook(() => useLimitedModels());
    await waitFor(() => expect(result.current).toEqual([]));
    const refused = renderHook(() => useLimitedModels());
    await waitFor(() => expect(refused.result.current).toEqual([]));
  });
});

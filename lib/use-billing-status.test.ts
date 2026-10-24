// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingClientView } from "./client";
import { loadBilling, planCta, resetBillingStatus, useBillingPrefetch, useBillingStatus } from "./use-billing-status";

const api = vi.hoisted(() => ({ billingStatus: vi.fn<() => Promise<BillingClientView>>() }));
vi.mock("./client", () => ({ api }));

const pro = {
  org: { slug: "acme", name: "Acme" },
  plan: { id: "pro" as const, name: "Pro" },
  status: "active",
  interval: "monthly" as const,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  puku: null,
  manageUrl: "https://weft.zip/acme/billing",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetBillingStatus();
});
afterEach(cleanup);

describe("useBillingStatus", () => {
  it("is undefined until the first answer, then the plan", async () => {
    api.billingStatus.mockResolvedValue(pro);
    const { result } = renderHook(() => useBillingStatus());
    expect(result.current).toBeUndefined();
    await vi.waitFor(() => expect(result.current).toEqual(pro));
  });

  it("turns a failed fetch into an error view", async () => {
    api.billingStatus.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useBillingStatus());
    await vi.waitFor(() => expect(result.current).toEqual({ error: "Couldn't load your plan." }));
  });

  it("asks again when the window regains focus, and stops listening once unmounted", async () => {
    api.billingStatus.mockResolvedValue(null);
    const { result, unmount } = renderHook(() => useBillingStatus());
    await vi.waitFor(() => expect(result.current).toBeNull());
    api.billingStatus.mockResolvedValue(pro);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await vi.waitFor(() => expect(result.current).toEqual(pro));
    unmount();
    window.dispatchEvent(new Event("focus"));
    expect(api.billingStatus).toHaveBeenCalledTimes(2);
  });

  it("renders nothing known on the server", () => {
    function Probe() {
      return useBillingStatus() === undefined ? "unknown" : "known";
    }
    expect(renderToString(createElement(Probe))).toBe("unknown");
  });

  it("shares one request while it's on its way", async () => {
    api.billingStatus.mockResolvedValue(pro);
    await Promise.all([loadBilling(), loadBilling()]);
    expect(api.billingStatus).toHaveBeenCalledTimes(1);
  });
});

describe("useBillingPrefetch", () => {
  it("loads once you're signed in, not before", () => {
    api.billingStatus.mockResolvedValue(pro);
    const { rerender } = renderHook(({ id }: { id?: string }) => useBillingPrefetch(id), { initialProps: {} });
    expect(api.billingStatus).not.toHaveBeenCalled();
    rerender({ id: "u1" });
    expect(api.billingStatus).toHaveBeenCalledTimes(1);
  });
});

describe("planCta", () => {
  it("offers Pro to plans without an allowance and billing to paid ones", () => {
    for (const id of ["free", "oss", "edu"] as const) expect(planCta(id)).toEqual({ label: "Upgrade to Pro", upgrade: true });
    for (const id of ["pro", "team"] as const) expect(planCta(id)).toEqual({ label: "Manage billing", upgrade: false });
  });
});

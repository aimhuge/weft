// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingClientView } from "@/lib/client";
import { closeUpgrade, useUpgradeReason } from "@/lib/use-upgrade";
import "./test-utils";
import BillingStatus from "./BillingStatus";

const api = vi.hoisted(() => ({
  billingStatus: vi.fn<() => Promise<BillingClientView>>(),
}));
vi.mock("@/lib/client", () => ({ api }));

const openExternal = vi.fn();

const PRO = {
  org: { slug: "ada", name: "Ada" },
  plan: { id: "pro" as const, name: "Pro" },
  status: "active",
  interval: "monthly" as const,
  periodEnd: "2026-11-13T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  puku: { meter: "puku_tokens", allowance: 300_000_000, granted: 0, spent: 12_345_678, remaining: 287_654_322, window: { start: "2026-10-13T00:00:00.000Z", end: "2026-11-13T00:00:00.000Z" }, resets: true },
  manageUrl: "https://weft.zip/ada/billing",
};

function setup() {
  render(<BillingStatus />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.weft = { openExternal } as unknown as typeof window.weft;
});

describe("BillingStatus", () => {
  it("hides itself when the user is signed out (null)", async () => {
    api.billingStatus.mockResolvedValue(null);
    setup();
    await waitFor(() => expect(api.billingStatus).toHaveBeenCalled());
    expect(screen.queryByText(/Plan:/)).not.toBeInTheDocument();
  });

  it("shows a 'Checking your plan' spinner on the first load", async () => {
    api.billingStatus.mockReturnValue(new Promise(() => {}));
    setup();
    expect(await screen.findByText(/Checking your plan/)).toBeInTheDocument();
  });

  it("renders the Pro row, the usage bar, and Manage billing, opening the manage URL externally", async () => {
    api.billingStatus.mockResolvedValue(PRO);
    setup();
    expect(
      await screen.findByText((_, el) => el?.textContent === "Plan: Pro · Ada"),
    ).toBeInTheDocument();
    expect(screen.getByText(/12\.3M of 300M tokens/)).toBeInTheDocument();
    const manage = screen.getByRole("button", { name: /Manage billing/ });
    await userEvent.click(manage);
    expect(openExternal).toHaveBeenCalledWith("https://weft.zip/ada/billing");
  });

  it("shows the Free trial hint and an Upgrade to Pro button that opens the upgrade dialog", async () => {
    api.billingStatus.mockResolvedValue({
      ...PRO,
      plan: { id: "free", name: "Free" },
      puku: null,
    });
    setup();
    expect(
      await screen.findByText((_, el) => el?.textContent === "Plan: Free · Ada"),
    ).toBeInTheDocument();
    expect(screen.getByText("Puku trial: 1M tokens a day")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Upgrade to Pro/ }));
    expect(openExternal).not.toHaveBeenCalled();
    expect(renderHook(() => useUpgradeReason()).result.current).toBe("plan");
    act(() => closeUpgrade());
  });

  it("offers Manage billing on Team, not an upgrade", async () => {
    api.billingStatus.mockResolvedValue({ ...PRO, plan: { id: "team", name: "Team" } });
    setup();
    expect(await screen.findByRole("button", { name: /Manage billing/ })).toBeInTheDocument();
  });

  it("shows a cancel notice on Pro when cancelAtPeriodEnd is set", async () => {
    api.billingStatus.mockResolvedValue({ ...PRO, cancelAtPeriodEnd: true });
    setup();
    expect(await screen.findByText(/Cancels on /)).toBeInTheDocument();
  });

  it("renders the error message from the API", async () => {
    api.billingStatus.mockResolvedValue({ error: "Weft's billing answered 503." });
    setup();
    expect(await screen.findByText("Weft's billing answered 503.")).toBeInTheDocument();
  });

  it("refetches on window focus so coming back from Checkout updates it", async () => {
    api.billingStatus.mockResolvedValue(PRO);
    setup();
    await screen.findByText((_, el) => el?.textContent === "Plan: Pro · Ada");
    expect(api.billingStatus).toHaveBeenCalledTimes(1);
    api.billingStatus.mockResolvedValueOnce({ ...PRO, plan: { id: "free", name: "Free" }, puku: null });
    window.dispatchEvent(new Event("focus"));
    expect(
      await screen.findByText((_, el) => el?.textContent === "Plan: Free · Ada"),
    ).toBeInTheDocument();
    expect(api.billingStatus).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic error when the call throws", async () => {
    api.billingStatus.mockRejectedValueOnce(new Error("network"));
    setup();
    expect(await screen.findByText("Couldn't load billing.")).toBeInTheDocument();
  });
});

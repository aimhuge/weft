// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingClientView } from "@/lib/client";
import { UPGRADE_COPY } from "@/lib/billing/upgrade";
import { resetBillingStatus } from "@/lib/use-billing-status";
import { closeUpgrade, openUpgrade } from "@/lib/use-upgrade";
import "./test-utils";
import UpgradeDialog, { type Checkout } from "./UpgradeDialog";

const api = vi.hoisted(() => ({
  billingStatus: vi.fn<() => Promise<BillingClientView>>(),
  billingCheckout: vi.fn<(plan: string, interval: string) => Promise<unknown>>(),
}));
vi.mock("@/lib/client", () => ({ api }));

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ track }));

const openExternal = vi.fn();
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";

const FREE = {
  org: { slug: "acme", name: "Acme Labs" },
  plan: { id: "free" as const, name: "Free" },
  status: "active",
  interval: "monthly" as const,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  puku: null,
  manageUrl: "https://weft.zip/acme/billing",
};
const PRO = { ...FREE, plan: { id: "pro" as const, name: "Pro" } };

function renderDialog(checkout?: Checkout) {
  return render(<UpgradeDialog checkout={checkout} />);
}

// The dialog mounts with the reason already set (a paywall opened it), so open first, then render.
async function open(reason: "teams" | "plan" | "puku-cap" | "share-room" = "plan", checkout?: Checkout) {
  openUpgrade(reason);
  const view = renderDialog(checkout);
  await screen.findByRole("dialog");
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  closeUpgrade();
  resetBillingStatus();
  api.billingStatus.mockResolvedValue(FREE);
  api.billingCheckout.mockResolvedValue({ ok: true, url: CHECKOUT_URL });
  window.weft = { openExternal } as unknown as typeof window.weft;
});

afterEach(() => {
  closeUpgrade();
  resetBillingStatus();
});

describe("UpgradeDialog", () => {
  it("renders nothing until something opens it", () => {
    const { container } = renderDialog();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with the reason's words from the copy", async () => {
    await open("teams");
    expect(screen.getByRole("dialog")).toHaveTextContent(UPGRADE_COPY.teams.title);
    expect(screen.getByRole("dialog")).toHaveTextContent(UPGRADE_COPY.teams.sub);
    expect(track).toHaveBeenCalledWith("upgrade_dialog_opened", { reason: "teams" });
  });

  it("shows Free, Pro and Team side by side, with the catalog's prices", async () => {
    await open();
    const free = screen.getByRole("region", { name: "Free" });
    const pro = screen.getByRole("region", { name: "Pro" });
    const team = screen.getByRole("region", { name: "Team" });
    expect(free).toHaveTextContent("$0");
    expect(free).toHaveTextContent("forever");
    expect(pro).toHaveTextContent("$20");
    expect(pro).toHaveTextContent("/month");
    expect(team).toHaveTextContent("$9");
    expect(team).toHaveTextContent("per seat / month");
  });

  it("switches to yearly prices and the saving when you pick Yearly", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Yearly" }));
    const pro = screen.getByRole("region", { name: "Pro" });
    expect(pro).toHaveTextContent("$200");
    expect(pro).toHaveTextContent("/year");
    expect(pro).toHaveTextContent("Save $40 a year");
  });

  it("marks the plan you're on as Current", async () => {
    await open();
    await waitFor(() => expect(screen.getByRole("region", { name: "Free" })).toHaveTextContent("Current"));
    expect(screen.getByRole("region", { name: "Pro" })).not.toHaveTextContent("Current");
    expect(screen.getByRole("region", { name: "Team" })).not.toHaveTextContent("Current");
  });

  it("starts Checkout for Pro and waits for Stripe in the desktop", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await waitFor(() => expect(api.billingCheckout).toHaveBeenCalledWith("pro", "monthly"));
    expect(openExternal).toHaveBeenCalledWith(CHECKOUT_URL);
    expect(await screen.findByRole("status")).toHaveTextContent("Finish checkout on Stripe");
    expect(track).toHaveBeenCalledWith("upgrade_checkout_started", { plan: "pro", interval: "monthly", reason: "plan" });
  });

  it("passes the yearly interval along when you switched before upgrading", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Yearly" }));
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await waitFor(() => expect(api.billingCheckout).toHaveBeenCalledWith("pro", "yearly"));
  });

  it("opens Checkout in the same tab with a checkout action and no desktop shell", async () => {
    delete (window as unknown as { weft?: unknown }).weft;
    const assign = vi.fn();
    const original = window.location;
    // @ts-expect-error - jsdom's location is unforgeable; the stub stands in for it.
    delete window.location;
    // @ts-expect-error - the stub stands in for jsdom's location.
    window.location = { assign, href: original.href } as unknown as Location;
    try {
      const checkout: Checkout = vi.fn().mockResolvedValue({ ok: true, url: CHECKOUT_URL });
      await open("plan", checkout);
      await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
      await waitFor(() => expect(checkout).toHaveBeenCalledWith("pro", "monthly"));
      expect(assign).toHaveBeenCalledWith(CHECKOUT_URL);
    } finally {
      // @ts-expect-error - put jsdom's location back.
      delete window.location;
      // @ts-expect-error - put jsdom's location back.
      window.location = original;
    }
  });

  it("opens Checkout in a new tab outside the desktop and without a checkout action", async () => {
    delete (window as unknown as { weft?: unknown }).weft;
    const openTab = vi.spyOn(window, "open").mockReturnValue(null);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith(CHECKOUT_URL, "_blank", "noopener"));
    openTab.mockRestore();
  });

  it("shows a refusal from Checkout in an alert", async () => {
    api.billingCheckout.mockResolvedValue({ ok: false, error: "Stripe said no." });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stripe said no.");
  });

  it("shows the message of a failed checkout call", async () => {
    api.billingCheckout.mockRejectedValue(new Error("Couldn't reach Stripe."));
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Stripe.");
  });

  it("marks the Free card with an Open Source workspace's own plan name", async () => {
    api.billingStatus.mockResolvedValue({ ...FREE, plan: { id: "oss", name: "Open Source" } });
    await open();
    await waitFor(() => expect(screen.getByRole("region", { name: "Free" })).toHaveTextContent("Open Source"));
    expect(screen.getByRole("region", { name: "Free" })).not.toHaveTextContent("Current");
  });

  it("goes back to the plans from the waiting line with Pick again", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await userEvent.click(await screen.findByRole("button", { name: "Pick again" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Upgrade to Pro" })).toBeEnabled();
  });

  it("asks for the plan again and says thanks when the change already applied", async () => {
    api.billingCheckout.mockResolvedValue({ ok: true, applied: true });
    await open();
    // The first load has landed, so the next one is a fresh ask.
    await waitFor(() => expect(screen.getByRole("region", { name: "Free" })).toHaveTextContent("Current"));
    const before = api.billingStatus.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await waitFor(() => expect(api.billingStatus.mock.calls.length).toBeGreaterThan(before));
    // Nothing to wait for: the change is already in place.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/your workspace is upgraded/)).toBeInTheDocument();
  });

  it("polls for the new plan every four seconds while Checkout is open, then says thanks", async () => {
    const timers = vi.spyOn(window, "setInterval");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await screen.findByRole("status");
    let poll: (() => void) | undefined;
    await waitFor(() => {
      const call = timers.mock.calls.find(([, ms]) => ms === 4000);
      expect(call).toBeDefined();
      poll = call![0];
    });
    const before = api.billingStatus.mock.calls.length;
    // The webhook lands a moment after you're back from Stripe.
    api.billingStatus.mockResolvedValue(PRO);
    await act(async () => {
      poll!();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.billingStatus.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByRole("dialog")).toHaveTextContent("Thanks");
    expect(screen.getByRole("dialog")).toHaveTextContent("You're on Pro");
    timers.mockRestore();
  });

  it("closes on Done in the thanks panel", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await screen.findByRole("status");
    // The webhook lands: the next load shows the new plan.
    api.billingStatus.mockResolvedValue(PRO);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Thanks");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells a teams invite to try again once you're on Pro", async () => {
    await open("teams");
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro" }));
    await screen.findByRole("status");
    api.billingStatus.mockResolvedValue(PRO);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Send that invite again");
  });

  it("closes on Escape", async () => {
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on the close button", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

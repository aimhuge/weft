// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The recovery menu reads the router; these tests don't mount an app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// A blank's hint in the 🔐 drawer: shown in full, its links open in the browser pane.
const NAME = "STRIPE_PRICE_PRO_MONTHLY_ID_FOR_THE_TEAM_PLAN";

const overview: VaultOverview = {
  unlocked: false,
  vaults: [
    {
      id: "github:o/web",
      label: "o/web",
      folder: "/dev/web",
      folders: ["/dev/web"],
      secrets: [{ name: NAME, environment: "development", missing: true, tail: "", updatedAt: "", hint: "Stripe → Products → Pro: https://dashboard.stripe.com/products." }],
      nudge: null,
    },
  ],
};

function setup() {
  const b = { overview: vi.fn(), scan: vi.fn(), import: vi.fn(), reveal: vi.fn(), copy: vi.fn(), set: vi.fn(), addBlank: vi.fn(), copyTo: vi.fn(), remove: vi.fn(), lock: vi.fn() };
  render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={overview} error={null} reload={vi.fn(() => Promise.resolve())} project="/dev/web" notify={vi.fn()} />);
}

describe("VaultDrawer blank hints", () => {
  it("shows the whole name and hint, wrapped rather than cut off", () => {
    setup();
    expect(screen.getByTitle(/has no value yet/)).toHaveTextContent(NAME);
    expect(screen.getByTitle(/has no value yet/)).not.toHaveClass("truncate");
    expect(screen.getByText("Stripe → Products → Pro:", { exact: false }).closest("p")).not.toHaveClass("truncate");
  });

  it("opens a hint's link in the browser pane", async () => {
    const open = vi.fn(() => Promise.resolve());
    Object.assign(window, { weft: { browser: { open } } });
    setup();
    await userEvent.click(screen.getByRole("link", { name: "dashboard.stripe.com/products" }));
    expect(open).toHaveBeenCalledWith("https://dashboard.stripe.com/products", "board");
    Object.assign(window, { weft: undefined });
  });
});

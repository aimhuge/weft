// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSecret } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const blank = (name: string, environment: VaultSecret["environment"] = "development"): VaultSecret => ({ name, environment, missing: true, tail: "", updatedAt: "" });
const value = (name: string, environment: VaultSecret["environment"] = "development"): VaultSecret => ({ name, environment, missing: false, tail: "abcd", updatedAt: "x" });

function setup(secrets: VaultSecret[]) {
  const overview: VaultOverview = { unlocked: false, vaults: [{ id: "github:o/web", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], secrets, nudge: null }] };
  const b = { overview: vi.fn(), scan: vi.fn(), import: vi.fn(), reveal: vi.fn(), copy: vi.fn(), set: vi.fn(), addBlank: vi.fn(), copyTo: vi.fn(), remove: vi.fn(), lock: vi.fn() };
  render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={overview} error={null} reload={vi.fn(() => Promise.resolve())} project="/dev/web" notify={vi.fn()} />);
}

const many = ["A_KEY", "B_KEY", "C_KEY", "D_KEY"].map((n) => blank(n));

describe("the 🔐 drawer's To fill in list", () => {
  it("folds many blanks into one header above the values, and opens on a click", async () => {
    setup([...many, value("STRIPE_SECRET_KEY")]);
    const header = screen.getByRole("button", { name: /To fill in · 4/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("A_KEY")).not.toBeInTheDocument();
    expect(screen.getByText("STRIPE_SECRET_KEY")).toBeInTheDocument();
    await userEvent.click(header);
    expect(screen.getByText("A_KEY")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Fill in/ })).toHaveLength(4);
    await userEvent.click(header);
    expect(screen.queryByText("A_KEY")).not.toBeInTheDocument();
  });

  it("is open with only a few, says where a blank is set, and has no separate blank chip", () => {
    setup([blank("ASC_KEY_ID"), value("ASC_KEY_ID", "production"), blank("MAC_CERT", "production")]);
    expect(screen.getByRole("button", { name: /To fill in · 2/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("set in production")).toBeInTheDocument();
    expect(screen.getByText("production", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("blank")).not.toBeInTheDocument();
  });

  it("opens while searching", async () => {
    setup([...many, value("STRIPE_SECRET_KEY")]);
    await userEvent.type(screen.getByPlaceholderText(/Filter secrets/), "KEY");
    expect(screen.getByText("A_KEY")).toBeInTheDocument();
  });

  it("isn't there without blanks", () => {
    setup([value("STRIPE_SECRET_KEY")]);
    expect(screen.queryByRole("button", { name: /To fill in/ })).not.toBeInTheDocument();
  });
});

describe("the 🔐 drawer's header and status line", () => {
  it("opens Settings → Secrets from ⚙ and from the status line", async () => {
    const heard = vi.fn();
    window.addEventListener("weft:open-settings", heard);
    setup([value("STRIPE_SECRET_KEY")]);
    expect(screen.queryByRole("button", { name: "Import…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manage o/web" }));
    await userEvent.click(screen.getByRole("button", { name: /On this Mac only/ }));
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener("weft:open-settings", heard);
  });
});

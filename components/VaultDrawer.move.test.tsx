// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSecret } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The recovery menu reads the router; these tests don't mount an app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Changing a secret's environments in the 🔐 drawer: moving it, or spreading a blank, from its ✎ / Fill in form.
const overviewWith = (secret: VaultSecret): VaultOverview => ({
  unlocked: false,
  vaults: [{ id: "github:o/web", label: "o/web", folder: "/dev/web", folders: ["/dev/web"], secrets: [secret], nudge: null }],
});

function setup(ov: VaultOverview) {
  const b = {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(() => Promise.resolve({ saved: true as const })),
    addBlank: vi.fn(() => Promise.resolve({ label: "o/web", filled: [] })),
    copyTo: vi.fn(),
    remove: vi.fn(() => Promise.resolve({ removed: true })),
    lock: vi.fn(() => Promise.resolve({ unlocked: false as const })),
  };
  render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={ov} error={null} reload={vi.fn(() => Promise.resolve())} project="/dev/web" notify={vi.fn()} />);
  return { b };
}

describe("VaultDrawer environment change", () => {
  it("moves a secret to another environment when you change its environments", async () => {
    const { b } = setup(overviewWith({ name: "EMAIL_TO", environment: "production", missing: false, tail: "1111", updatedAt: "" }));
    await userEvent.click(screen.getByRole("button", { name: "Change EMAIL_TO" }));
    await userEvent.click(screen.getByRole("button", { name: "Development" }));
    await userEvent.click(screen.getByRole("button", { name: "Production" }));
    await userEvent.type(screen.getByLabelText("Value"), "me@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Move to Development" }));
    expect(b.set).toHaveBeenCalledWith("/dev/web", "EMAIL_TO", "development", "me@x.com");
    expect(b.set).toHaveBeenCalledTimes(1);
    expect(b.remove).toHaveBeenCalledWith("github:o/web", "EMAIL_TO", "production");
  });

  it("spreads a blank to another environment without a value", async () => {
    const { b } = setup(overviewWith({ name: "EMAIL_TO", environment: "production", missing: true, tail: "", updatedAt: "", source: "a thread" }));
    await userEvent.click(screen.getByRole("button", { name: "Fill in EMAIL_TO" }));
    // In place, a blank still needs its value.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Development" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to 2 environments" }));
    expect(b.addBlank).toHaveBeenCalledWith("/dev/web", "EMAIL_TO", "development");
    expect(b.addBlank).toHaveBeenCalledWith("/dev/web", "EMAIL_TO", "production");
    expect(b.remove).not.toHaveBeenCalled();
    expect(b.set).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
// The 🔐 drawer's "Show recovery key" item (docs/architecture/teams-vault.md, "Recovery key").
//
// The item's whole job is to be there when it should be and to point at the vault's own recovery
// page. It shows itself only for a vault that is shared with a workspace — a local vault has
// nothing to recover — and it says whether the key was shown before, so the user can see whether
// they have done this already.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSummary } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The item opens the vault's recovery page with next/navigation's useRouter().push — the app
// router isn't mounted in a test, so the router is stubbed.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const shared = {
  org: { id: "o1", slug: "acme", name: "Acme" },
  vaultId: "v1",
  keyVersion: 3,
  serverVersion: 7,
  recoveryShownAt: null as string | null,
};

const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  id: "github:o/web",
  label: "o/web",
  folder: "/dev/web",
  folders: ["/dev/web"],
  secrets: [],
  nudge: null,
  ...over,
});

const withShared = (over: Partial<VaultSummary> = {}): VaultOverview => ({
  unlocked: false,
  vaults: [vault({ shared, ...over })],
});

// The drawer only asks the shell for a menu when the shell has one; the menu is the shell's own.
function setup(vaults: VaultSummary[], popupMenu?: (items: unknown) => Promise<unknown>) {
  if (popupMenu) (window as unknown as { weft: unknown }).weft = { popupMenu };
  const bridge = {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    lock: vi.fn(),
  };
  const overview: VaultOverview = { unlocked: false, vaults };
  render(<VaultDrawer bridge={bridge as unknown as VaultBridge} overview={overview} error={null} reload={vi.fn()} project="/dev/web" notify={vi.fn()} />);
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("the recovery key's menu item", () => {
  it("isn't offered for a vault that isn't shared", () => {
    setup([vault()]);
    expect(screen.queryByRole("button", { name: /Show recovery key/ })).not.toBeInTheDocument();
  });

  it("is offered for a shared vault, and says the key was never shown", () => {
    setup(withShared().vaults);
    expect(screen.getByRole("button", { name: /Show recovery key/ })).toBeInTheDocument();
    expect(screen.getByText("never shown")).toBeInTheDocument();
  });

  it("says when the key was last shown", () => {
    setup(withShared({ shared: { ...shared, recoveryShownAt: "2026-10-27T10:00:00.000Z" } }).vaults);
    expect(screen.getByText("shown before")).toBeInTheDocument();
  });

  it("offers to open the recovery page, and the page is the vault's own", async () => {
    const popupMenu = vi.fn((items: unknown) => {
      // The menu the drawer asks for: the native entries the shell shows.
      expect(items).toBeDefined();
      return Promise.resolve("recovery");
    });
    setup(withShared().vaults, popupMenu);
    await userEvent.click(screen.getByRole("button", { name: /Show recovery key/ }));
    await waitFor(() => expect(popupMenu).toHaveBeenCalled());
    const items = popupMenu.mock.calls[0]![0] as { id: string; label: string }[];
    expect(items.some((i) => i.label === "Show recovery key")).toBe(true);
    expect(items.some((i) => i.label === "Open the recovery page")).toBe(true);
  });
});

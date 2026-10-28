// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSummary } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The drawer's recovery menu item opens the recovery page with next/navigation's useRouter().push —
// the app router isn't mounted in a test, so the hook is replaced.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The 🔐 drawer's two tabs (docs/architecture/teams-vault.md, "What the 🔐 drawer shows"): the
// secrets, and the shared vault's event log.
const overview: VaultOverview = {
  unlocked: false,
  vaults: [
    {
      id: "github:o/web",
      label: "o/web",
      folder: "/dev/web",
      folders: ["/dev/web"],
      secrets: [{ name: "API_KEY", environment: "development", missing: false, tail: "1111", updatedAt: "" }],
      nudge: null,
    } satisfies VaultSummary,
  ],
};

function setup() {
  const b = {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(() => Promise.resolve({ saved: true as const })),
    copyTo: vi.fn(() => Promise.resolve({ copied: true as const, label: "notes", replaced: false })),
    remove: vi.fn(),
    lock: vi.fn(() => Promise.resolve({ unlocked: false as const })),
  };
  const events = vi.fn(() => Promise.resolve({ events: [], since: null, shared: true, userId: "u1" }));
  (window as unknown as { weft: unknown }).weft = { vault: { events } };
  const view = render(
    <VaultDrawer bridge={b as unknown as VaultBridge} overview={overview} error={null} reload={vi.fn(() => Promise.resolve())} project="/dev/web" notify={vi.fn()} />,
  );
  return { events, view };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("the drawer's tabs", () => {
  it("opens on the secrets and can switch to the event log and back", async () => {
    setup();
    expect(screen.getByRole("tab", { name: "Secrets" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "o/web" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Event log" }));
    expect(screen.getByRole("tab", { name: "Event log" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "o/web" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Secrets" }));
    expect(screen.getByRole("heading", { name: "o/web" })).toBeInTheDocument();
  });

  it("asks the shell for the log of the vault under the filter", async () => {
    const { events } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Event log" }));
    expect(events).toHaveBeenCalledWith("github:o/web", { scope: "mine" });
  });
});

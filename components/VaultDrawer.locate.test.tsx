// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ImportScan, VaultBridge, VaultOverview } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The 🔐 drawer's Import all on the nudge, and Locate… in a vault's header and the import preview.
const AWAY = "../web-build/.env.local";

const overview: VaultOverview = {
  unlocked: false,
  vaults: [
    {
      id: "github:o/web",
      label: "o/web",
      folder: "/dev/web",
      folders: ["/dev/web"],
      secrets: [{ name: "KEY", environment: "development", missing: true, tail: "", updatedAt: "" }],
      nudge: { count: 1, file: AWAY },
    },
  ],
};

const scan: ImportScan = {
  id: "github:o/web",
  label: "o/web",
  files: [{ file: AWAY, environment: "development", namesOnly: false, tracked: false, vercel: false, elsewhere: true }],
  rows: [{ file: AWAY, name: "KEY", environment: "development", status: "new", tail: "1111", public: false, ticked: true, skipped: false }],
};

function setup(over: Partial<Record<keyof VaultBridge, unknown>> = {}) {
  const b = { overview: vi.fn(), scan: vi.fn(() => Promise.resolve(scan)), import: vi.fn(() => Promise.resolve({ imported: 1 })), reveal: vi.fn(), copy: vi.fn(), set: vi.fn(), addBlank: vi.fn(), copyTo: vi.fn(), remove: vi.fn(), lock: vi.fn(), locate: vi.fn(() => Promise.resolve({ file: AWAY })), ...over };
  const notify = vi.fn();
  const reload = vi.fn(() => Promise.resolve());
  render(<VaultDrawer bridge={b as unknown as VaultBridge} overview={overview} error={null} reload={reload} project="/dev/web" notify={notify} />);
  return { b, notify, reload };
}

describe("VaultDrawer Import all and Locate…", () => {
  it("imports everything the nudge found in one click, and says so", async () => {
    const { b, notify, reload } = setup();
    expect(screen.getByText(`Found 1 secret in ${AWAY}: move it into the vault?`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import all" }));
    await waitFor(() => expect(b.import).toHaveBeenCalledWith("/dev/web", [{ file: AWAY, name: "KEY" }]));
    expect(notify).toHaveBeenCalledWith(`Imported 1 secret from ${AWAY}.`);
    expect(reload).toHaveBeenCalled();
  });

  it("locates a file, then previews it with Locate… still at hand", async () => {
    const { b } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    expect(b.locate).toHaveBeenCalledWith("/dev/web");
    expect(await screen.findByText("Import into o/web")).toBeInTheDocument();
    expect(screen.getByText(`${AWAY} · development`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    expect(b.locate).toHaveBeenCalledTimes(2);
  });

  it("toasts a file with nothing in it, stays put when you cancel, and toasts a failure", async () => {
    const locate = vi.fn().mockResolvedValueOnce({ file: "id_rsa", empty: true }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no dialog"));
    const { b, notify } = setup({ locate });
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("id_rsa has no NAME=value lines, so Weft didn't keep it."));
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "no dialog" })));
    expect(b.scan).not.toHaveBeenCalled();
  });

  it("hides Locate… in a shell too old to open the dialog", () => {
    setup({ locate: undefined });
    expect(screen.queryByRole("button", { name: "Locate…" })).toBeNull();
  });
});

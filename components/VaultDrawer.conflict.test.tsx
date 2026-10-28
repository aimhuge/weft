// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultOverview, VaultSummary } from "@/lib/vault-view";
import "./test-utils";
import VaultDrawer from "./VaultDrawer";

// The drawer's recovery menu item opens the recovery page with next/navigation's useRouter().push —
// the app router isn't mounted in a test, so the hook is replaced.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The 🔐 drawer's conflict UX (docs/architecture/teams-vault.md, "Push on change" and "What the 🔐
// drawer shows"). A write that lost against a teammate's leaves a banner on that secret's row, with
// the two ways out: keep your edit (written again against the row's current version) and keep theirs
// (the server's row, which is already in the shadow). The banner is transient: it goes away on the
// re-render that follows the next reload.
//
// A local vault has no row_version, so it can never conflict: the drawer's set answers { saved: true }
// and there is no banner.

const VAULT_ID = "github:o/web";

const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  id: VAULT_ID,
  label: "o/web",
  folder: "/dev/web",
  folders: ["/dev/web"],
  secrets: [{ name: "API_KEY", environment: "development", missing: false, tail: "1111", updatedAt: "" }],
  nudge: null,
  ...over,
});

const overview = (over: Partial<VaultOverview> = {}): VaultOverview => ({ unlocked: false, vaults: [vault()], ...over });

// The conflict main answers: who wrote the row, which one, and the server's row_version.
const conflict = (over: Record<string, unknown> = {}) => ({
  name: "API_KEY",
  environment: "development",
  actor: "Sam",
  rowVersion: 4,
  blank: false,
  ...over,
});

// The drawer as the app holds it: the overview lives in state and every reload fetches it again, so
// a reload is a new overview and a new render (docs/architecture/teams-vault.md, "What the 🔐 drawer
// shows": the banner goes away on re-render after a reload). The button beside it is the reload the
// test triggers on its own, the way the board reloads the vaults when it comes back.
function Host({ bridge, ov, onReload }: { bridge: VaultBridge; ov: VaultOverview; onReload: () => void }) {
  const [current, setCurrent] = useState(ov);
  const reload = () => {
    onReload();
    setCurrent(overview());
    return Promise.resolve();
  };
  return (
    <>
      <button onClick={() => void reload()}>Reload the vaults</button>
      <VaultDrawer bridge={bridge} overview={current} error={null} reload={reload} project="/dev/web" notify={vi.fn()} />
    </>
  );
}

function setup(setResult: unknown, ov = overview()) {
  const b = {
    overview: vi.fn(),
    scan: vi.fn(),
    import: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    set: vi.fn(() => Promise.resolve(setResult)),
    addBlank: vi.fn(() => Promise.resolve({ label: "o/web", filled: [] })),
    copyTo: vi.fn(),
    remove: vi.fn(),
    lock: vi.fn(() => Promise.resolve({ unlocked: false as const })),
  };
  const reload = vi.fn();
  const view = render(<Host bridge={b as unknown as VaultBridge} ov={ov} onReload={reload} />);
  return { b, reload, view };
}

// Opens the Change form on API_KEY and saves a new value.
async function changeValue(value: string) {
  await userEvent.click(screen.getByRole("button", { name: "Change API_KEY" }));
  await userEvent.type(await screen.findByLabelText("Value"), value);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("the drawer's conflict banner", () => {
  it("shows who changed the secret, and offers the two ways out", async () => {
    setup({ saved: false, conflict: conflict() });
    await changeValue("my-new-value");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Sam changed API_KEY in development — keep your edit?");
    expect(screen.getByRole("button", { name: "Keep your edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep theirs" })).toBeInTheDocument();
  });

  it("keeps your edit by writing the same value again, against the row's current version", async () => {
    const { b } = setup({ saved: false, conflict: conflict() });
    await changeValue("my-new-value");
    await screen.findByRole("alert");

    b.set.mockResolvedValue({ saved: true as const });
    await userEvent.click(screen.getByRole("button", { name: "Keep your edit" }));

    await waitFor(() => expect(b.set).toHaveBeenCalledTimes(2));
    // The same name, the same environment, the same value the user typed.
    expect(b.set).toHaveBeenLastCalledWith("/dev/web", "API_KEY", "development", "my-new-value");
  });

  it("keeps theirs by writing nothing: the server's row is already in the shadow", async () => {
    const { b } = setup({ saved: false, conflict: conflict() });
    await changeValue("my-new-value");
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "Keep theirs" }));

    await waitFor(() => expect(b.set).toHaveBeenCalledTimes(1));
  });

  it("goes away on the re-render after the next reload", async () => {
    const { reload } = setup({ saved: false, conflict: conflict() });
    await changeValue("my-new-value");
    await screen.findByRole("alert");

    // The reload the conflicted write itself caused keeps the banner.
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // The next reload takes it away.
    await userEvent.click(screen.getByRole("button", { name: "Reload the vaults" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows nothing for a blank: the drawer keeps the new value silently", async () => {
    setup({ saved: false, conflict: conflict({ blank: true }) });
    await changeValue("my-new-value");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("never shows a value in the banner", async () => {
    setup({ saved: false, conflict: conflict() });
    await changeValue("my-new-value");
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).not.toContain("my-new-value");
    expect(banner.textContent).not.toContain("1111");
  });

  it("shows no banner for a local vault, which can never conflict", async () => {
    const { b } = setup({ saved: true });
    await changeValue("my-new-value");
    await waitFor(() => expect(b.set).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

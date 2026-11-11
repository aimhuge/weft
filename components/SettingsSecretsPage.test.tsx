// @vitest-environment jsdom
// Settings → Secrets (docs/architecture/secrets.md, "The drawer and Settings → Secrets"): what moved out of the 🔐
// drawer. Env files (Import… with the .env.local offer, Locate…), sharing (Share…, Ask to join, the Macs asking, the
// recovery key), the event log, and the Keychain log.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportScan, VaultBridge, VaultOverview, VaultSummary } from "@/lib/vault-view";
import "./test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./KeychainAccess", () => ({ default: () => <div>keychain log</div> }));
const vaults = vi.hoisted((): { current: unknown } => ({ current: null }));
vi.mock("@/lib/use-board-vaults", () => ({ useBoardVaults: () => vaults.current }));

import SettingsSecretsPage from "./SettingsSecretsPage";
import { openSecretsSettings } from "@/lib/secrets-settings";
import { askVault } from "@/lib/vault-ask";
import { useVaultAsk } from "@/lib/vault-ask";
import { renderHook } from "@testing-library/react";

const ORG = { id: "o1", slug: "acme", name: "Acme", members: 2, admin: true };
const shared = { org: { id: "o1", slug: "acme", name: "Acme" }, vaultId: "v1", keyVersion: 3, serverVersion: 7, recoveryShownAt: null as string | null };
const vault = (over: Partial<VaultSummary> = {}): VaultSummary => ({
  id: "github:o/web",
  label: "o/web",
  folder: "/dev/web",
  folders: ["/dev/web"],
  secrets: [{ name: "API_KEY", environment: "development", missing: false, tail: "1111", updatedAt: "" }, { name: "B", environment: "development", missing: true, tail: "", updatedAt: "" }],
  nudge: null,
  ...over,
});

function bridge(over: Record<string, unknown> = {}) {
  return { overview: vi.fn(), scan: vi.fn(), import: vi.fn(), reveal: vi.fn(), copy: vi.fn(), set: vi.fn(), copyTo: vi.fn(), remove: vi.fn(), lock: vi.fn(), locate: vi.fn(), share: vi.fn(() => Promise.resolve({})), ...over };
}

function setup(list: VaultSummary[] = [vault()], b: Record<string, unknown> | null = bridge(), extra: Partial<VaultOverview> = {}) {
  const reload = vi.fn(() => Promise.resolve());
  const overview: VaultOverview = { unlocked: false, vaults: list, orgs: [ORG], ...extra };
  vaults.current = { bridge: b as unknown as VaultBridge, overview, error: null, reload };
  render(<SettingsSecretsPage />);
  return { b: b as ReturnType<typeof bridge>, reload };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

const local = { file: ".env.local", environment: "development" as const, namesOnly: false, tracked: false, vercel: false };
const row = { file: ".env.local", name: "DB", environment: "development" as const, status: "new" as const, tail: "", public: false, ticked: true, skipped: false };
const scan: ImportScan = { id: "github:o/web", label: "o/web", files: [local], rows: [row] };

describe("Settings → Secrets", () => {
  it("says why there's nothing: off the desktop, loading, a failure, no project", () => {
    vaults.current = { bridge: null, overview: null, error: null, reload: vi.fn() };
    const { unmount } = render(<SettingsSecretsPage />);
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    unmount();
    vaults.current = { bridge: bridge(), overview: null, error: "locked", reload: vi.fn() };
    const second = render(<SettingsSecretsPage />);
    expect(screen.getByText("locked")).toBeInTheDocument();
    second.unmount();
    vaults.current = { bridge: bridge(), overview: null, error: null, reload: vi.fn() };
    const third = render(<SettingsSecretsPage />);
    expect(screen.getByText("Opening the vaults…")).toBeInTheDocument();
    third.unmount();
    setup([]);
    expect(screen.getByText(/Add a project to the board/)).toBeInTheDocument();
    expect(screen.getByText("keychain log")).toBeInTheDocument();
  });

  it("shows each vault's counts, and that it's on this Mac only with Share…", () => {
    setup();
    expect(screen.getByRole("heading", { name: "o/web" })).toBeInTheDocument();
    expect(screen.getByText("1 value · 1 to fill in")).toBeInTheDocument();
    expect(screen.getByText("On this Mac only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Share…/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show recovery key/ })).not.toBeInTheDocument();
  });

  it("says a folder with no GitHub repo stays here", () => {
    setup([vault({ id: "folder:/dev/notes", label: "notes", secrets: [] })]);
    expect(screen.getByText(/No GitHub repo/)).toBeInTheDocument();
    expect(screen.getByText("0 values")).toBeInTheDocument();
  });

  it("imports with the .env.local offer, and leaves it out for a managed one", async () => {
    const writeBack = vi.fn(() => Promise.resolve({ written: true as const, file: ".env.local", gitignoreAdded: false }));
    const { b } = setup([vault()], bridge({ writeBack, scan: vi.fn(() => Promise.resolve(scan)), import: vi.fn(() => Promise.resolve({ imported: 1 })) }));
    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    expect(await screen.findByLabelText("Then let Weft write .env.local from the vault")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Import 1" }));
    await waitFor(() => expect(writeBack).toHaveBeenCalledWith("/dev/web"));
    expect(await screen.findByText("Weft now writes .env.local from the vault.")).toBeInTheDocument();
    expect(b.import).toHaveBeenCalled();
  });

  it("says Weft writes .env.local for a managed vault, and doesn't offer it again", async () => {
    setup([vault({ managed: true })], bridge({ writeBack: vi.fn(), scan: vi.fn(() => Promise.resolve({ ...scan, rows: [] })) }));
    expect(screen.getByText("Weft writes .env.local from this vault")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    await screen.findByText("Import into o/web");
    expect(screen.queryByLabelText("Then let Weft write .env.local from the vault")).not.toBeInTheDocument();
  });

  it("locates a file and previews it, toasts a failure, and hides Locate… in an older shell", async () => {
    const locate = vi.fn().mockResolvedValueOnce({ file: ".env.away" }).mockRejectedValueOnce(new Error("no dialog"));
    const { b } = setup([vault()], bridge({ locate, scan: vi.fn(() => Promise.resolve(scan)) }));
    await userEvent.click(screen.getByRole("button", { name: "Locate…" }));
    expect(locate).toHaveBeenCalledWith("/dev/web");
    expect(await screen.findByText("Import into o/web")).toBeInTheDocument();
    expect(b.scan).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Cancel|Close/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Locate…" }));
    expect(await screen.findByText("no dialog")).toBeInTheDocument();
  });

  it("hides Locate… in a shell too old to open the dialog", () => {
    setup([vault()], bridge({ locate: undefined }));
    expect(screen.queryByRole("button", { name: "Locate…" })).toBeNull();
  });

  it("shows a shared vault's workspace, its recovery key, and its event log on demand", async () => {
    const events = vi.fn(() => Promise.resolve({ events: [], since: null, shared: true, userId: "u1" }));
    const popupMenu = vi.fn(() => Promise.resolve("recovery"));
    (window as unknown as { weft: unknown }).weft = { vault: { events }, popupMenu };
    setup([vault({ shared })]);
    expect(screen.getByText("Shared with Acme")).toBeInTheDocument();
    expect(screen.getByText("never shown")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Show recovery key/ }));
    await waitFor(() => expect(popupMenu).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Show who changed what" }));
    expect(events).toHaveBeenCalledWith("github:o/web", { scope: "mine" });
    await userEvent.click(screen.getByRole("button", { name: "Hide who changed what" }));
    expect(screen.queryByRole("button", { name: /Share…/ })).not.toBeInTheDocument();
  });

  it("says when the recovery key was last shown", () => {
    setup([vault({ shared: { ...shared, recoveryShownAt: "2026-10-27T10:00:00.000Z" } })]);
    expect(screen.getByText("shown before")).toBeInTheDocument();
  });

  it("offers Ask to join, the Macs asking, and why there's no join", () => {
    const join = { vaultId: "v1", orgId: "o1", repo: "o/web", state: "none" as const, fingerprint: "ab:cd" };
    const requests = [{ id: "p1", person: "Sam", deviceName: "m1mini", fingerprint: "ff:ee" }];
    setup([vault({ join }), vault({ id: "github:o/api", label: "o/api", requests, shared }), vault({ id: "github:o/x", label: "o/x", joinHint: "none" })], bridge({ requestJoin: vi.fn(), join: vi.fn(), deviceGrant: vi.fn(), deviceDecline: vi.fn() }));
    expect(screen.getByRole("button", { name: "Ask to join" })).toBeInTheDocument();
    expect(screen.getByText(/Sam asks to add m1mini/)).toBeInTheDocument();
    expect(screen.getByText(/Not shared yet/)).toBeInTheDocument();
  });

  it("opens the share dialog on the vault a weft://secrets?share=1 link asked for", async () => {
    const pick = vi.fn();
    (window as unknown as { weft: unknown }).weft = {};
    renderHook(() => useVaultAsk([vault()], pick));
    askVault(vi.fn(), { repo: "o/web", share: true });
    setup();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("brings the vault the drawer's ⚙ asked for into view", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    openSecretsSettings("github:o/web");
    setup();
    expect(scroll).toHaveBeenCalled();
  });
});

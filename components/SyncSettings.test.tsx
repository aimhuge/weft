// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";

const useCloudSync = vi.hoisted(() => vi.fn());
const useAccount = vi.hoisted(() => vi.fn());
const openTeamPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/use-cloud-sync", () => ({ useCloudSync }));
vi.mock("@/lib/use-account", () => ({ useAccount }));
vi.mock("./board-palette", () => ({ openTeamPage }));
vi.mock("./PhoneSettings", () => ({ default: () => <div>Phones card</div> }));

const { default: SyncSettings } = await import("./SyncSettings");

const EMPTY: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const READY: CloudSyncStatus = { waiting: 2, lastSyncAt: 1000, uploaded: 5, lastError: null, signedOut: false, noWorkspace: false };

interface UseCloudSyncApi {
  folders: string[];
  status: CloudSyncStatus;
  error: string | null;
  reload: () => Promise<void>;
  setFolder: (folder: string, on: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
}

let api: UseCloudSyncApi;

beforeEach(() => {
  vi.clearAllMocks();
  api = {
    folders: [],
    status: EMPTY,
    error: null,
    reload: vi.fn(() => Promise.resolve()),
    setFolder: vi.fn(() => Promise.resolve()),
    syncNow: vi.fn(() => Promise.resolve()),
  };
  useCloudSync.mockReturnValue(api);
  useAccount.mockReturnValue({ state: { kind: "ready", view: { configured: true, user: { id: "u1" } } } });
});

describe("SyncSettings", () => {
  it("renders the Status card with a Sync now button when the user is signed in and has a workspace", () => {
    api.status = READY;
    api.folders = ["/sync"];
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText(/last sync/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeInTheDocument();
    expect(screen.getByText("5 items uploaded · 2 waiting")).toBeInTheDocument();
  });

  it("renders the signed-out card instead of the Status card when there's no Weft account", () => {
    useAccount.mockReturnValue({ state: { kind: "ready", view: { configured: true, user: null } } });
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText("Sign in to Weft")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("renders the no-workspace card when the user is signed in but has no workspace", () => {
    api.status = { ...EMPTY, noWorkspace: true };
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText("No workspace yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /open the web board/i }).length).toBeGreaterThan(0);
  });

  it("calls syncNow when the Sync now button is clicked", async () => {
    api.status = READY;
    render(<SyncSettings recentProjects={["/sync"]} />);
    await userEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(api.syncNow).toHaveBeenCalledTimes(1);
  });

  it("shows why a switch failed instead of throwing", async () => {
    api.setFolder = vi.fn(() => Promise.reject(new Error("Couldn't reach Weft's server.")));
    useCloudSync.mockReturnValue(api);
    render(<SyncSettings recentProjects={["/other"]} />);
    await userEvent.click(screen.getAllByRole("switch")[0]!);
    expect(await screen.findByText(/Couldn't save that: Couldn't reach Weft's server\./)).toBeInTheDocument();
  });

  it("shows why Sync now failed instead of throwing", async () => {
    api.syncNow = vi.fn(() => Promise.reject(new Error("Server busy.")));
    useCloudSync.mockReturnValue(api);
    render(<SyncSettings recentProjects={[]} />);
    await userEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(await screen.findByText(/Couldn't sync: Server busy\./)).toBeInTheDocument();
  });

  it("calls setFolder when a project's switch is flipped on", async () => {
    render(<SyncSettings recentProjects={["/sync", "/other"]} />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    await userEvent.click(switches[0]!);
    expect(api.setFolder).toHaveBeenCalledWith("/other", true);
  });

  it("lists the user's recent projects even when no folder is in syncFolders", () => {
    render(<SyncSettings recentProjects={["/a", "/b"]} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("renders an empty-state when there are no recent projects and no synced folders", () => {
    const { container } = render(<SyncSettings recentProjects={[]} />);
    expect(screen.getByText(/no recent projects yet/i)).toBeInTheDocument();
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
  });

  it("shows the last error in the Status card", () => {
    api.status = { ...READY, lastError: "boom" };
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText("Last sync failed")).toBeInTheDocument();
    expect(screen.getByText(/last error: boom/i)).toBeInTheDocument();
  });

  it("opens the web board from the description card", async () => {
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText(/go to your weft workspace on weft\.zip/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /open the web board/i }));
    expect(openTeamPage).toHaveBeenCalledTimes(1);
  });

  it("warns that thread text is uploaded unencrypted", () => {
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText(/thread text is uploaded unencrypted/i)).toBeInTheDocument();
  });

  it("shows a project's switch on when its folder is syncing", () => {
    api.folders = ["/sync"];
    render(<SyncSettings recentProjects={["/sync", "/other"]} />);
    const [other, sync] = screen.getAllByRole("switch");
    expect(other).toHaveAttribute("aria-checked", "false");
    expect(sync).toHaveAttribute("aria-checked", "true");
  });

  it("flips a synced project's switch off", async () => {
    api.folders = ["/sync"];
    render(<SyncSettings recentProjects={["/sync"]} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(api.setFolder).toHaveBeenCalledWith("/sync", false);
  });

  it("shows a fetch error from the hook", () => {
    api.error = "Server down";
    render(<SyncSettings recentProjects={["/sync"]} />);
    expect(screen.getByText(/couldn't reach the server: server down/i)).toBeInTheDocument();
  });
});

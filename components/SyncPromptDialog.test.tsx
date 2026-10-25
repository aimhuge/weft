// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";
import { promptOff, resetSyncPrompt } from "@/lib/sync-prompt";
import { resetAskedForTests } from "@/lib/use-sync-prompt";
import { makeCard } from "./test-utils";
import SyncPromptDialog from "./SyncPromptDialog";

const STATUS: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };

const api = vi.hoisted(() => ({
  cloudSync: vi.fn(),
  cloudSyncSetFolder: vi.fn(),
}));
vi.mock("@/lib/client", () => ({ api }));

const welcome = vi.hoisted(() => ({ loadWelcome: vi.fn() }));
vi.mock("@/lib/welcome-client", () => welcome);

type AccountStub = { kind: "ready"; view: { user: { id: string } | null } };
const account = vi.hoisted(() => ({ signIn: vi.fn(), state: null as unknown as AccountStub }));
vi.mock("@/lib/use-account", () => ({ useAccount: () => ({ state: account.state, signIn: account.signIn }) }));

const openTeamPage = vi.hoisted(() => vi.fn());
vi.mock("./board-palette", () => ({ openTeamPage }));

const APP = "/Users/me/dev/app";

function setup(cards = [makeCard({ cwd: APP })], cwd: string | null = null) {
  const toast = vi.fn();
  render(<SyncPromptDialog cwd={cwd} cards={cards} toast={toast} />);
  return { toast };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAskedForTests();
  resetSyncPrompt();
  account.state = { kind: "ready", view: { user: { id: "u1" } } };
  welcome.loadWelcome.mockResolvedValue({ welcome: { at: 1 } });
  api.cloudSync.mockResolvedValue({ folders: [], status: STATUS });
  api.cloudSyncSetFolder.mockResolvedValue({ folder: APP, on: true, folders: [APP], status: STATUS });
});

describe("SyncPromptDialog", () => {
  it("asks to sync the project, turns sync on and says so", async () => {
    const { toast } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Sync app" }));
    expect(api.cloudSyncSetFolder).toHaveBeenCalledWith(APP, true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast).toHaveBeenCalledWith("app is syncing to your web dashboard.");
  });

  it("asks once a launch, and Don't show me again keeps it away for good", async () => {
    setup();
    await userEvent.click(await screen.findByLabelText("Don't show me again"));
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(promptOff()).toBe(true);
    expect(api.cloudSyncSetFolder).not.toHaveBeenCalled();
  });

  it("Not now alone leaves the box unticked", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(promptOff()).toBe(false);
  });

  it("doesn't ask before the welcome is answered, about a synced project, or with nothing finished", async () => {
    welcome.loadWelcome.mockResolvedValueOnce({ welcome: null });
    setup();
    await waitFor(() => expect(welcome.loadWelcome).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();

    resetAskedForTests();
    api.cloudSync.mockResolvedValueOnce({ folders: [APP], status: STATUS });
    setup();
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();

    setup([makeCard({ cwd: APP, column: "running" })]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays closed when the welcome can't be read", async () => {
    welcome.loadWelcome.mockRejectedValueOnce(new Error("offline"));
    setup();
    await waitFor(() => expect(welcome.loadWelcome).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays closed when the sync list can't be read, and a failed re-read keeps it open", async () => {
    api.cloudSync.mockRejectedValueOnce(new Error("offline"));
    setup();
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("signed out, the button signs you in", async () => {
    account.state = { kind: "ready", view: { user: null } };
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
    expect(account.signIn).toHaveBeenCalledWith("github");
  });

  it("with no workspace, the button opens the web board", async () => {
    api.cloudSync.mockResolvedValue({ folders: [], status: { ...STATUS, noWorkspace: true } });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Open the web board" }));
    expect(openTeamPage).toHaveBeenCalled();
  });

  it("shows why a sync failed and stays open", async () => {
    api.cloudSyncSetFolder.mockRejectedValueOnce(new Error("Server restarting"));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Sync app" }));
    expect(await screen.findByText("Couldn't turn sync on: Server restarting")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reads the status again when the window comes back into focus", async () => {
    setup();
    await screen.findByRole("dialog");
    api.cloudSync.mockClear();
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalledTimes(1));
    api.cloudSync.mockRejectedValueOnce(new Error("offline"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(api.cloudSync).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

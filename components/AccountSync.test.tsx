// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { CloudSyncStatus } from "@/lib/cloud-sync-view";

const openTeamPage = vi.hoisted(() => vi.fn());
vi.mock("./board-palette", () => ({ openTeamPage }));
// A fixed clock, so "Synced 5m ago" doesn't depend on the real one.
vi.mock("@/lib/use-now", () => ({ useNow: () => 10 * 60_000 }));

const { default: AccountSync } = await import("./AccountSync");

const OK: CloudSyncStatus = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };

function fakeSync(over: { folders?: string[]; status?: Partial<CloudSyncStatus> } = {}) {
  return {
    folders: over.folders ?? [],
    status: { ...OK, ...over.status },
    error: null,
    reload: vi.fn(() => Promise.resolve()),
    read: vi.fn(() => Promise.resolve({ folders: over.folders ?? [], status: { ...OK, ...over.status } })),
    setFolder: vi.fn(() => Promise.resolve()),
    syncNow: vi.fn(() => Promise.resolve()),
  };
}

const show = (sync: ReturnType<typeof fakeSync>, project: string | null = null) => render(<AccountSync sync={sync} project={project} />);

beforeEach(() => vi.clearAllMocks());

describe("AccountSync", () => {
  it("says how long ago it synced, and offers Resync now and Don't sync for a synced project", async () => {
    const sync = fakeSync({ folders: ["/dev/weft"], status: { lastSyncAt: 5 * 60_000 } });
    show(sync, "/dev/weft");
    expect(screen.getByText("Synced 5m ago")).toBeInTheDocument();
    expect(screen.getByText("1 project sync to weft.zip")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Resync now" }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("menuitem", { name: "Don't sync weft" }));
    expect(sync.setFolder).toHaveBeenCalledWith("/dev/weft", false);
  });

  it("offers Sync <project> for a project that isn't synced, with what it uploads", async () => {
    const sync = fakeSync({ folders: ["/dev/other"] });
    show(sync, "/dev/weft");
    const item = screen.getByRole("menuitem", { name: /Sync weft/ });
    expect(item).toHaveTextContent("Uploads its threads, unencrypted for now");
    await userEvent.click(item);
    expect(sync.setFolder).toHaveBeenCalledWith("/dev/weft", true);
  });

  it("is off with no folders: no Resync now, just the project's switch", () => {
    show(fakeSync(), "/dev/weft");
    expect(screen.getByText("Sync is off")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Resync now" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Sync weft/ })).toBeInTheDocument();
  });

  it("leaves out the project item without a project", () => {
    show(fakeSync({ folders: ["/a"] }), null);
    expect(screen.getByRole("menuitem", { name: "Resync now" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("shows the items waiting", () => {
    show(fakeSync({ folders: ["/a", "/b"], status: { waiting: 3 } }));
    expect(screen.getByText("Syncing 3 items…")).toBeInTheDocument();
    expect(screen.getByText("2 projects sync to weft.zip")).toBeInTheDocument();
  });

  it("shows a sync error in red", () => {
    show(fakeSync({ folders: ["/a"], status: { lastError: "HTTP 500" } }));
    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByText("HTTP 500")).toHaveClass("text-danger");
  });

  it("offers nothing to do while signed out", () => {
    show(fakeSync({ folders: ["/a"], status: { signedOut: true } }), "/a");
    expect(screen.getByText("Sign in to sync")).toBeInTheDocument();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("opens the web board when there's no workspace yet", async () => {
    show(fakeSync({ folders: ["/a"], status: { noWorkspace: true } }), "/a");
    expect(screen.getByText("No workspace yet")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Resync now" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Sync a/ })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Open the web board" }));
    expect(openTeamPage).toHaveBeenCalledTimes(1);
  });

  it("disables Resync now with a spinner while it runs, then frees it", async () => {
    const sync = fakeSync({ folders: ["/a"] });
    let done: () => void = () => undefined;
    sync.syncNow.mockImplementation(() => new Promise<void>((resolve) => (done = resolve)));
    const { container } = show(sync);
    const item = screen.getByRole("menuitem", { name: "Resync now" });
    expect(container.querySelector(".animate-spin")).toBeNull();
    await userEvent.click(item);
    expect(item).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    done();
    await vi.waitFor(() => expect(item).toBeEnabled());
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("disables the project item while it runs", async () => {
    const sync = fakeSync({ folders: [] });
    let done: () => void = () => undefined;
    sync.setFolder.mockImplementation(() => new Promise<void>((resolve) => (done = resolve)));
    show(sync, "/dev/weft");
    const item = screen.getByRole("menuitem", { name: /Sync weft/ });
    await userEvent.click(item);
    expect(item).toBeDisabled();
    done();
    await vi.waitFor(() => expect(item).toBeEnabled());
  });

  it("says why a resync failed, and clears it on the next try", async () => {
    const sync = fakeSync({ folders: ["/a"] });
    sync.syncNow.mockRejectedValueOnce(new Error("offline"));
    show(sync);
    const item = screen.getByRole("menuitem", { name: "Resync now" });
    await userEvent.click(item);
    expect(await screen.findByText("Couldn't: offline")).toBeInTheDocument();
    expect(item).toBeEnabled();
    await userEvent.click(item);
    await vi.waitFor(() => expect(screen.queryByText(/Couldn't/)).toBeNull());
  });

  it("says why a switch failed, even when the rejection isn't an Error", async () => {
    const sync = fakeSync();
    sync.setFolder.mockRejectedValueOnce("not on the board");
    show(sync, "/dev/weft");
    await userEvent.click(screen.getByRole("menuitem", { name: /Sync weft/ }));
    expect(await screen.findByText("Couldn't: not on the board")).toBeInTheDocument();
  });
});

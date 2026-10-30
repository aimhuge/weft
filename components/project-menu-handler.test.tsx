// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import { makeCard } from "./test-utils";
import type { MenuItem } from "@/lib/card-menu";

const api = vi.hoisted(() => ({
  markProject: vi.fn(() => Promise.resolve({ projects: [] })),
  repos: vi.fn(() => Promise.resolve({ repos: [{ path: "/p", github: "me/p" }] })),
  workerFolders: vi.fn(() => Promise.resolve({ folders: [] as string[] })),
  setWorkerFolder: vi.fn((_folder: string, on: boolean) => Promise.resolve({ folders: on ? ["/p"] : [], worker: on ? "m1mini" : undefined })),
  cloudSyncSetFolder: vi.fn(() =>
    Promise.resolve({
      folder: "/p",
      on: true,
      folders: ["/p"],
      status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
    }),
  ),
}));
vi.mock("@/lib/client", () => ({ api }));
const stopNow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow }));
const openChangelog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/changelog-open", () => ({ openChangelog }));

const event = (preventDefault = vi.fn()) => ({ preventDefault, stopPropagation: vi.fn() }) as unknown as React.MouseEvent;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(pick: string | null, over: Partial<ProjectMenuDeps> = {}, shellOver: Record<string, unknown> = {}) {
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  const shell = {
    popupMenu,
    revealFolder: vi.fn(),
    openExternal: vi.fn(),
    openIn: vi.fn(() => Promise.resolve("Cursor")),
    ...shellOver,
  };
  (window as unknown as { weft: unknown }).weft = shell;
  const deps = {
    projects: [{ path: "/p", lastActivity: 0, cards: 3, running: 1, needsYou: 0, pinned: true }],
    cards: [
      makeCard({ id: "d1", cwd: "/p", column: "done" }),
      makeCard({ id: "d2", cwd: "/p/.wt", column: "done", archived: true }),
      makeCard({ id: "r1", cwd: "/p/.wt", column: "running" }),
      makeCard({ id: "x", cwd: "/other", column: "done" }),
    ],
    rootOf: (cwd: string) => (cwd.startsWith("/p") ? "/p" : cwd),
    openNew: vi.fn(),
    chooseProject: vi.fn(),
    openDrawer: vi.fn(),
    archive: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    syncFolders: [],
    syncStatus: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
    // Reads back what the board knows, so a test's `syncFolders` is what the menu sees.
    readSync: vi.fn(() => Promise.resolve({ folders: [], status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false } })),
    ...over,
  } satisfies ProjectMenuDeps;
  if (!over.readSync) {
    // The default read answers with the folders the deps claim, unless the test says otherwise.
    deps.readSync = vi.fn(() => Promise.resolve({ folders: deps.syncFolders, status: deps.syncStatus }));
  }
  const onMenu = projectMenuHandler(deps);
  return { deps, shell, popupMenu, run: async () => { const picked = await onMenu("/p", event()); await flush(); return picked; } };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("projectMenuHandler", () => {
  it("leaves the browser's own menu alone without a shell", async () => {
    const onMenu = projectMenuHandler({} as ProjectMenuDeps);
    const preventDefault = vi.fn();
    expect(await onMenu("/p", event(preventDefault))).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("builds the menu from the project's marks and its own unarchived cards", async () => {
    const { popupMenu, run } = setup(null);
    expect(await run()).toBe(false);
    const items = popupMenu.mock.calls[0]![0];
    const byId = (id: string) => items.find((i) => "id" in i && i.id === id);
    expect(byId("unpin")).toBeTruthy();
    expect(byId("archive-done")).toMatchObject({ label: "Archive 1 Card in Done" });
    expect(byId("stop-running")).toMatchObject({ label: "Stop 1 Running Card" });
    expect(byId("editor")).toBeTruthy();
  });

  it("starts a thread, reveals, copies and opens the changelog for the project", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    let t = setup("new");
    await t.run();
    expect(t.deps.openNew).toHaveBeenCalledWith("/p");
    t = setup("reveal");
    await t.run();
    expect(t.shell.revealFolder).toHaveBeenCalledWith("/p");
    t = setup("copy-path");
    await t.run();
    expect(writeText).toHaveBeenCalledWith("/p");
    t = setup("changelog");
    expect(await t.run()).toBe(true);
    expect(openChangelog).toHaveBeenCalledWith("/p");
  });

  it("opens the folder in an editor or terminal, and says when there's none", async () => {
    let t = setup("editor");
    await t.run();
    expect(t.shell.openIn).toHaveBeenCalledWith("/p", "editor");
    expect(t.deps.toast).toHaveBeenCalledWith("Opened p in Cursor.");
    t = setup("terminal", {}, { openIn: vi.fn(() => Promise.resolve(null)) });
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("No terminal app found in Applications.");
    t = setup("editor", {}, { openIn: vi.fn(() => Promise.resolve(null)) });
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("No code editor found in Applications.");
  });

  it("opens the repo on GitHub, or says it has no remote", async () => {
    let t = setup("github");
    await t.run();
    expect(t.shell.openExternal).toHaveBeenCalledWith("https://github.com/me/p");
    api.repos.mockResolvedValueOnce({ repos: [] });
    t = setup("github");
    await t.run();
    expect(t.deps.toast).toHaveBeenCalledWith("p has no GitHub remote.");
  });

  it("opens the secrets and dev server drawers on the project", async () => {
    let t = setup("secrets");
    await t.run();
    expect(t.deps.chooseProject).toHaveBeenCalledWith("/p");
    expect(t.deps.openDrawer).toHaveBeenCalledWith("vault");
    t = setup("services");
    await t.run();
    expect(t.deps.openDrawer).toHaveBeenCalledWith("services");
  });

  it("pins, unpins, hides and shows the project", async () => {
    for (const [pick, marks] of [["pin", { pinned: true }], ["unpin", { pinned: false }], ["hide", { hidden: true }], ["show", { hidden: false }]] as const) {
      await setup(pick).run();
      expect(api.markProject).toHaveBeenLastCalledWith("/p", marks);
    }
  });

  it("archives its Done cards and stops its running ones", async () => {
    let t = setup("archive-done");
    await t.run();
    expect(t.deps.archive).toHaveBeenCalledWith([expect.objectContaining({ id: "d1" })]);
    t = setup("stop-running");
    await t.run();
    expect(stopNow).toHaveBeenCalledWith("r1");
    expect(t.deps.toast).toHaveBeenCalledWith("Stopped 1 card in p.");
  });

  it("turns cloud sync on for the project, and off again when it already syncs", async () => {
    let t = setup("sync");
    await t.run();
    expect(api.cloudSyncSetFolder).toHaveBeenCalledWith("/p", true);
    expect(t.deps.toast).toHaveBeenCalledWith("p now syncs to weft.zip (unencrypted for now).");
    t = setup("sync", { syncFolders: ["/p"] });
    await t.run();
    expect(api.cloudSyncSetFolder).toHaveBeenLastCalledWith("/p", false);
    expect(t.deps.toast).toHaveBeenLastCalledWith("p no longer syncs.");
  });

  it("switches the project's new threads to the worker, and back to this machine", async () => {
    let t = setup("run-worker");
    await t.run();
    expect(api.setWorkerFolder).toHaveBeenCalledWith("/p", true);
    expect(t.deps.toast).toHaveBeenCalledWith("New threads in p now run on m1mini.");
    t = setup("run-here");
    await t.run();
    expect(api.setWorkerFolder).toHaveBeenLastCalledWith("/p", false);
    expect(t.deps.toast).toHaveBeenLastCalledWith("New threads in p run on this machine again.");
  });

  it("ticks Run on Worker for a project that runs there, and this machine when the read fails", async () => {
    api.workerFolders.mockResolvedValueOnce({ folders: ["/p"] });
    let t = setup(null);
    await t.run();
    expect(t.popupMenu.mock.calls[0]![0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "run-worker", checked: true })]));
    api.workerFolders.mockRejectedValueOnce(new Error("offline"));
    t = setup(null);
    await t.run();
    expect(t.popupMenu.mock.calls[0]![0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "run-here", checked: true })]));
  });

  it("shows where sync stands beside the Sync item, read fresh", async () => {
    const status = { waiting: 0, lastSyncAt: Date.now() - 7 * 60_000, uploaded: 3, lastError: null, signedOut: false, noWorkspace: false };
    const t = setup(null, { readSync: vi.fn(() => Promise.resolve({ folders: ["/p"], status })) });
    await t.run();
    expect(t.deps.readSync).toHaveBeenCalled();
    const items = t.popupMenu.mock.calls[0]![0];
    const sync = items.find((i) => "id" in i && i.id === "sync");
    expect(sync).toMatchObject({ label: "Don't Sync p", detail: "Synced 7m ago" });
  });

  it("says Not Synced for a project that isn't opted in, even when others are", async () => {
    const status = { waiting: 0, lastSyncAt: Date.now() - 60_000, uploaded: 3, lastError: null, signedOut: false, noWorkspace: false };
    const t = setup(null, { readSync: vi.fn(() => Promise.resolve({ folders: ["/other"], status })) });
    await t.run();
    const items = t.popupMenu.mock.calls[0]![0];
    const sync = items.find((i) => "id" in i && i.id === "sync");
    expect(sync).toMatchObject({ label: "Sync p", detail: "Not Synced" });
  });

  it("still opens the menu when the sync read fails", async () => {
    const t = setup(null, { readSync: vi.fn(() => Promise.reject(new Error("offline"))) });
    expect(await t.run()).toBe(false);
    const items = t.popupMenu.mock.calls[0]![0];
    expect(items.find((i) => "id" in i && i.id === "sync")).toMatchObject({ label: "Sync p", detail: "Not Synced" });
  });

  it("reports a failed action", async () => {
    api.markProject.mockRejectedValueOnce(new Error("nope"));
    const t = setup("pin");
    await t.run();
    expect(t.deps.notify).toHaveBeenCalledWith(new Error("nope"));
  });

  it("offers a worker project only a new thread, and never asks this Mac about it", async () => {
    const path = "worker://w1/ling";
    const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve("new"));
    (window as unknown as { weft: unknown }).weft = { popupMenu };
    const openNew = vi.fn();
    const onMenu = projectMenuHandler({
      projects: [{ path, lastActivity: 0, cards: 1, running: 0, needsYou: 0, worker: { name: "m1mini", status: "online" } }],
      cards: [],
      rootOf: (cwd: string) => cwd,
      openNew,
      chooseProject: vi.fn(),
      openDrawer: vi.fn(),
      archive: vi.fn(),
      toast: vi.fn(),
      notify: vi.fn(),
      syncFolders: [],
      syncStatus: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
      readSync: vi.fn(() => Promise.resolve({ folders: [], status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false } })),
    });
    expect(await onMenu(path, event())).toBe(true);
    expect(popupMenu.mock.calls[0]![0]).toEqual([{ id: "new", label: "New Thread in ling", enabled: true, detail: "on m1mini" }]);
    expect(openNew).toHaveBeenCalledWith(path);
    // A worker project has no folder here, so nothing asks this Mac where it runs.
    expect(api.workerFolders).not.toHaveBeenCalled();
  });
});

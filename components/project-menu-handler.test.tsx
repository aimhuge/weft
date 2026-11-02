// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import { makeCard } from "./test-utils";
import type { MenuItem } from "@/lib/card-menu";

const api = vi.hoisted(() => ({
  markProject: vi.fn(() => Promise.resolve({ projects: [] })),
  setProjectFolder: vi.fn(() => Promise.resolve({ projects: [] })),
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
const hostAct = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/project-host", () => ({ hostOf: () => ({ act: hostAct }) }));
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

  it("adds a picked folder to the project, and does nothing when the picker is cancelled", async () => {
    const openFolder = vi.fn<() => Promise<string | null>>(() => Promise.resolve("/Users/me/api"));
    const t = setup("add-folder", {}, { dialog: { openFolder } });
    await t.run();
    expect(api.setProjectFolder).toHaveBeenCalledWith("/p", "/Users/me/api", true);
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining("api"));
    openFolder.mockResolvedValueOnce(null);
    vi.mocked(api.setProjectFolder).mockClear();
    await setup("add-folder", {}, { dialog: { openFolder } }).run();
    expect(api.setProjectFolder).not.toHaveBeenCalled();
  });

  it("lists the project's added folders and removes the one picked", async () => {
    const t = setup("remove-folder:/Users/me/api", { projects: [{ path: "/p", lastActivity: 0, cards: 0, running: 0, needsYou: 0, folders: ["/Users/me/api"] }] });
    await t.run();
    expect(t.popupMenu.mock.calls[0]![0]).toEqual(expect.arrayContaining([expect.objectContaining({ id: "remove-folder:/Users/me/api" })]));
    expect(api.setProjectFolder).toHaveBeenCalledWith("/p", "/Users/me/api", false);
    expect(t.deps.toast).toHaveBeenCalledWith("api is no longer part of p.");
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

  describe("on a worker project", () => {
    const path = "worker://w1/ling";
    function worker(pick: string | null, project: Record<string, unknown> = {}) {
      const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
      (window as unknown as { weft: unknown }).weft = { popupMenu };
      const deps = {
        projects: [{ path, lastActivity: 0, cards: 3, running: 1, needsYou: 0, worker: { name: "m1mini", status: "online" as const }, ...project }],
        cards: [makeCard({ id: "wd", cwd: path, column: "done" }), makeCard({ id: "wr", cwd: path, column: "running" }), makeCard({ id: "l", cwd: "/p", column: "done" })],
        rootOf: (cwd: string) => cwd,
        openNew: vi.fn(),
        chooseProject: vi.fn(),
        openDrawer: vi.fn(),
        archive: vi.fn(),
        toast: vi.fn(),
        notify: vi.fn(),
        syncFolders: [],
        syncStatus: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
        readSync: vi.fn(() => Promise.resolve({ folders: [], status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false } })),
      } satisfies ProjectMenuDeps;
      const onMenu = projectMenuHandler(deps);
      return { deps, popupMenu, run: async () => { const picked = await onMenu(path, event()); await flush(); return picked; } };
    }

    it("offers a new thread, pin, hide, archive and stop, and never asks this Mac about it", async () => {
      const t = worker("new");
      expect(await t.run()).toBe(true);
      const items = t.popupMenu.mock.calls[0]![0];
      expect(items[0]).toEqual({ id: "new", label: "New Thread in ling", enabled: true, detail: "on m1mini" });
      expect(items).toEqual(expect.arrayContaining([{ id: "archive-done", label: "Archive 1 Card in Done", enabled: true }, { id: "stop-running", label: "Stop 1 Running Card", enabled: true }]));
      expect(t.deps.openNew).toHaveBeenCalledWith(path);
      // A worker project has no folder here, so nothing asks this Mac where it runs or what it syncs.
      expect(api.workerFolders).not.toHaveBeenCalled();
      expect(t.deps.readSync).not.toHaveBeenCalled();
    });

    it("pins and hides it on this board, never in this Mac's project list", async () => {
      localStorage.clear();
      await worker("pin").run();
      await worker("hide").run();
      expect(JSON.parse(localStorage.getItem("weft-worker-project-marks")!)).toEqual({ [path]: { pinned: true, hidden: true } });
      await worker("unpin", { pinned: true }).run();
      await worker("show", { hidden: true }).run();
      expect(JSON.parse(localStorage.getItem("weft-worker-project-marks") ?? "{}")).toEqual({});
      expect(api.markProject).not.toHaveBeenCalled();
    });

    it("archives its Done cards and stops its running ones on the worker", async () => {
      const a = worker("archive-done");
      await a.run();
      expect(a.deps.archive).toHaveBeenCalledWith([expect.objectContaining({ id: "wd" })]);
      const s = worker("stop-running");
      await s.run();
      expect(stopNow).toHaveBeenCalledWith("wr", expect.any(Function));
      await (stopNow.mock.calls[0] as unknown as [string, () => Promise<void>])[1]();
      expect(hostAct).toHaveBeenCalledWith("card.stop", { id: "wr" });
      expect(s.deps.toast).toHaveBeenCalledWith("Stopped 1 card in ling.");
    });

    it("does nothing when the menu closes, and reports a failed action", async () => {
      expect(await worker(null).run()).toBe(false);
      stopNow.mockRejectedValueOnce(new Error("gone"));
      const t = worker("stop-running", { running: 2 });
      t.deps.cards.push(makeCard({ id: "wr2", cwd: path, column: "running" }));
      await t.run();
      expect(t.deps.notify).toHaveBeenCalledWith(new Error("gone"));
    });
  });
});

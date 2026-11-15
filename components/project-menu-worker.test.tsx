// @vitest-environment jsdom
// A worker project's right-click menu (lib/worker-project.ts workerProjectMenu), through the handler.
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import { makeCard } from "./test-utils";
import type { MenuItem } from "@/lib/card-menu";

const api = vi.hoisted(() => ({
  markProject: vi.fn(() => Promise.resolve({ projects: [] })),
  workerFolders: vi.fn(() => Promise.resolve({ folders: [] as string[] })),
}));
vi.mock("@/lib/client", () => ({ api }));
const stopNow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow }));
const hostAct = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/project-host", () => ({ hostOf: () => ({ act: hostAct }) }));
vi.mock("@/lib/changelog-open", () => ({ openChangelog: vi.fn() }));

const event = (preventDefault = vi.fn()) => ({ preventDefault, stopPropagation: vi.fn() }) as unknown as React.MouseEvent;
const flush = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("on a worker project", () => {
  const path = "worker://w1/ling";
  function worker(pick: string | null, project: Record<string, unknown> = {}) {
    const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
    (window as unknown as { weft: unknown }).weft = { popupMenu };
    const deps = {
      projects: [{ path, lastActivity: 0, cards: 3, running: 1, needsYou: 0, worker: { name: "m1mini", status: "online" as const }, ...project }],
      cards: [makeCard({ id: "wd", cwd: path, column: "done" }), makeCard({ id: "wr", cwd: path, column: "running" }), makeCard({ id: "l", cwd: "/p", column: "done" })],
      projectOf: (cwd: string) => cwd,
      workerProjects: [],
      openNew: vi.fn(),
      chooseProject: vi.fn(),
      openDrawer: vi.fn(),
      archive: vi.fn(),
      toast: vi.fn(),
      notify: vi.fn(),
      syncFolders: [],
      syncStatus: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false },
      readSync: vi.fn(() => Promise.resolve({ folders: [], status: { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false } })),
      shareBoard: vi.fn(),
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

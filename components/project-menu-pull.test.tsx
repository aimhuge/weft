// @vitest-environment jsdom
// A project menu's "Pull Uncommitted Work from <worker>" (components/project-menu-handler.ts, docs/architecture/wip-sync.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import type { MenuItem } from "@/lib/card-menu";

const api = vi.hoisted(() => ({
  pullWip: vi.fn(() => Promise.resolve({ note: "Pulled 2 files of uncommitted work from m1mini." })),
  workerFolders: vi.fn(() => Promise.resolve({ folders: [] as string[] })),
}));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow: vi.fn() }));
vi.mock("@/lib/project-host", () => ({ hostOf: vi.fn() }));
vi.mock("@/lib/changelog-open", () => ({ openChangelog: vi.fn() }));

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const status = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const project = (path: string, worker?: "online" | "offline") => ({ path, lastActivity: 0, cards: 0, running: 0, needsYou: 0, ...(worker ? { worker: { name: "m1mini", status: worker } } : {}) });

async function open(pick: string | null) {
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  (window as unknown as { weft: unknown }).weft = { popupMenu };
  const deps = {
    projects: [project("/dev/p"), project(`worker://${W}/p`, "online"), project(`worker://${W}/other`, "offline")],
    cards: [],
    rootOf: (cwd: string) => cwd,
    openNew: vi.fn(),
    chooseProject: vi.fn(),
    openDrawer: vi.fn(),
    archive: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    syncFolders: [],
    syncStatus: status,
    readSync: vi.fn(() => Promise.resolve({ folders: [], status })),
    shareBoard: vi.fn(),
  } satisfies ProjectMenuDeps;
  await projectMenuHandler(deps)("/dev/p", { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
  await new Promise((r) => setTimeout(r, 0));
  const pulls = (popupMenu.mock.calls[0]?.[0] ?? []).filter((i) => "id" in i && i.id.startsWith("pull-wip:"));
  return { deps, pulls };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("Pull Uncommitted Work", () => {
  it("is offered for the worker project with this project's folder name, and no other", async () => {
    expect((await open(null)).pulls).toEqual([{ id: `pull-wip:worker://${W}/p`, label: "Pull Uncommitted Work from m1mini", enabled: true }]);
    expect(api.pullWip).not.toHaveBeenCalled();
  });

  it("pulls into this project, saying it asked and then what came", async () => {
    const { deps } = await open(`pull-wip:worker://${W}/p`);
    expect(api.pullWip).toHaveBeenCalledWith("/dev/p", `worker://${W}/p`);
    expect(deps.toast.mock.calls).toEqual([["Asking for its uncommitted work…"], ["Pulled 2 files of uncommitted work from m1mini."]]);
  });

  it("reports a pull that was refused", async () => {
    api.pullWip.mockRejectedValueOnce(new Error("This Mac has uncommitted work of its own in main."));
    const { deps } = await open(`pull-wip:worker://${W}/p`);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "This Mac has uncommitted work of its own in main." }));
  });
});

// @vitest-environment jsdom
// A project menu's machine groups through the handler (lib/project-machines.ts): a submenu per machine when the shell
// draws them, a heading over flat items when not, and each item acting on the machine it sits under.
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import type { MenuItem } from "@/lib/card-menu";
import type { DeviceView } from "@/lib/device-registry";

const api = vi.hoisted(() => ({
  workerFolders: vi.fn(() => Promise.resolve({ folders: [] as string[] })),
  setWorkerFolder: vi.fn((_folder: string, on: boolean) => Promise.resolve({ folders: [], worker: on ? "m1mini" : undefined })),
  repos: vi.fn(() => Promise.resolve({ repos: [{ path: "/dev/p", github: "me/p" }] })),
  pullWip: vi.fn(() => Promise.resolve({ note: "Pulled." })),
}));
const macs = vi.hoisted(() => ({ myDevices: vi.fn(() => Promise.resolve([] as DeviceView[])), signMacAsk: vi.fn(() => Promise.resolve({ origin: "me/p", mac: "Studio", widen: { kind: "ed25519" } })) }));
const treeApi = vi.hoisted(() => vi.fn<(req: Record<string, unknown>) => Promise<Record<string, unknown>>>(() => Promise.resolve({ folders: [] })));
vi.mock("@/lib/client", () => ({ api }));
vi.mock("@/lib/mac-twins", () => macs);
vi.mock("@/lib/line-tree-sync", () => ({ treeSyncApi: treeApi }));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow: vi.fn() }));
vi.mock("@/lib/project-host", () => ({ hostOf: vi.fn() }));
vi.mock("@/lib/changelog-open", () => ({ openChangelog: vi.fn() }));

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const status = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const device = (over: Partial<DeviceView>) =>
  ({ id: "id", kind: "mac", name: "Mac", platform: "darwin", orgId: "o", host: null, status: "online", revokedAt: null, here: false, ...over }) as DeviceView;
const MINI = device({ id: W, kind: "worker", name: "m1mini", host: `worker:${W}` });
const STUDIO = device({ id: "studio", name: "Studio", host: "b".repeat(16) });
const WPATH = `worker://${W}/p`;

async function open(pick: string | null, submenus: boolean, devices: DeviceView[] = [MINI, STUDIO]) {
  macs.myDevices.mockResolvedValue(devices);
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  (window as unknown as { weft: unknown }).weft = { popupMenu, ...(submenus ? { menuSubmenus: true } : {}) };
  const deps = {
    projects: [{ path: "/dev/p", lastActivity: 0, cards: 0, running: 0, needsYou: 0 }],
    cards: [],
    projectOf: (cwd: string) => cwd,
    workerProjects: [{ path: WPATH, workerId: W, worker: "m1mini", folder: "p", status: "online" as const }],
    openNew: vi.fn(), chooseProject: vi.fn(), openDrawer: vi.fn(), archive: vi.fn(), toast: vi.fn(), notify: vi.fn(),
    syncFolders: ["/dev/p"], syncStatus: status, readSync: vi.fn(() => Promise.resolve({ folders: ["/dev/p"], status })), shareBoard: vi.fn(),
  } satisfies ProjectMenuDeps;
  await projectMenuHandler(deps)("/dev/p", { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
  await new Promise((r) => setTimeout(r, 0));
  return { deps, menu: popupMenu.mock.calls[0]![0] };
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("a project's machine groups", () => {
  it("is a submenu per machine when the shell draws them", async () => {
    const { menu } = await open(null, true);
    const groups = menu.filter((i) => "submenu" in i);
    expect(groups.map((g) => g.label)).toEqual(["m1mini", "Studio"]);
    expect(JSON.stringify(groups[0])).toContain(`pull-wip:${WPATH}`);
    expect(menu.some((i) => "id" in i && i.id.startsWith("machine:"))).toBe(false);
  });

  it("is a heading over flat items when it can't", async () => {
    const { menu } = await open(null, false);
    expect(menu.some((i) => "submenu" in i)).toBe(false);
    expect(menu).toEqual(expect.arrayContaining([{ id: "machine:m1mini", label: "m1mini", enabled: false }, expect.objectContaining({ id: `pull-wip:${WPATH}`, label: "Bring m1mini's Uncommitted Work Here" })]));
  });

  it("pulls from a worker's path, and from a Mac signed in that Mac's name", async () => {
    await open(`pull-wip:${WPATH}`, true);
    expect(api.pullWip).toHaveBeenCalledWith("/dev/p", WPATH, undefined);
    await open(`pull-wip:mac:${"b".repeat(16)}/p`, true);
    expect(macs.signMacAsk).toHaveBeenCalledWith("b".repeat(16), "p", "me/p", "Studio");
  });

  it("falls back to a generic name when the Mac isn't in the menu", async () => {
    await open(`pull-wip:mac:${"c".repeat(16)}/p`, true);
    expect(macs.signMacAsk).toHaveBeenCalledWith("c".repeat(16), "p", "me/p", "your other Mac");
  });

  it("keeps this Mac in sync with the worker, and moves the project there", async () => {
    const sync = await open(`sync-tree:${WPATH}`, true);
    expect(treeApi).toHaveBeenCalledWith(expect.objectContaining({ op: "enable", workerId: W, folder: "p" }));
    expect(sync.deps.toast).toHaveBeenCalledWith(expect.stringContaining("now syncs with m1mini"));
    treeApi.mockClear();
    const move = await open(`move-tree:${WPATH}`, true);
    expect(treeApi).toHaveBeenCalledWith(expect.objectContaining({ op: "lead", workerId: W }));
    expect(api.setWorkerFolder).toHaveBeenCalledWith("/dev/p", true);
    expect(move.deps.toast).toHaveBeenCalledWith(expect.stringContaining("Sending p's uncommitted work to m1mini"));
  });

  it("ignores a sync or move for a worker that isn't a twin", async () => {
    const other = `worker://${W}/zzz`;
    const a = await open(`sync-tree:${other}`, true);
    const b = await open(`move-tree:${other}`, true);
    expect(a.deps.toast).not.toHaveBeenCalled();
    expect(b.deps.toast).not.toHaveBeenCalled();
    expect(api.setWorkerFolder).not.toHaveBeenCalled();
  });

  it("starts new threads there from inside the machine's group, and back here once ticked", async () => {
    const there = await open("run-worker", true);
    expect(api.setWorkerFolder).toHaveBeenCalledWith("/dev/p", true);
    expect(there.deps.toast).toHaveBeenCalledWith("New threads in p now run on m1mini.");
    api.workerFolders.mockResolvedValueOnce({ folders: ["/dev/p"] });
    const back = await open("run-here", true);
    expect(JSON.stringify(back.menu)).toContain('"id":"run-here"');
    expect(api.setWorkerFolder).toHaveBeenLastCalledWith("/dev/p", false);
  });
});

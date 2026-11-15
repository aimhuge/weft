// @vitest-environment jsdom
// A project menu's "Bring <machine>'s Uncommitted Work Here" (components/project-menu-handler.ts, docs/architecture/wip-sync.md).
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";
import type { MenuItem } from "@/lib/card-menu";
import type { DeviceView } from "@/lib/device-registry";

const api = vi.hoisted(() => ({
  pullWip: vi.fn(() => Promise.resolve({ note: "Pulled 2 files of uncommitted work from m1mini." })),
  workerFolders: vi.fn(() => Promise.resolve({ folders: [] as string[] })),
  repos: vi.fn(() => Promise.resolve({ repos: [{ path: "/dev/p", github: "me/p" }] as { path: string; github?: string }[] })),
}));
const twins = vi.hoisted(() => ({
  myDevices: vi.fn(() => Promise.resolve([] as DeviceView[])),
  signMacAsk: vi.fn(() => Promise.resolve({ origin: "me/p", mac: "Studio", widen: { kind: "ed25519" } })),
}));
vi.mock("@/lib/mac-twins", () => twins);
vi.mock("@/lib/client", () => ({ api }));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow: vi.fn() }));
vi.mock("@/lib/project-host", () => ({ hostOf: vi.fn() }));
vi.mock("@/lib/changelog-open", () => ({ openChangelog: vi.fn() }));

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const status = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
const project = (path: string, worker?: "online" | "offline") => ({ path, lastActivity: 0, cards: 0, running: 0, needsYou: 0, ...(worker ? { worker: { name: "m1mini", status: worker } } : {}) });

const device = (over: Partial<DeviceView>) =>
  ({ id: "id", kind: "mac", name: "Mac", platform: "darwin", orgId: "o", host: null, status: "online", revokedAt: null, here: false, ...over }) as DeviceView;
const WORKER = device({ id: W, kind: "worker", name: "m1mini", host: `worker:${W}` });

const wproject = (folder: string, status: "online" | "offline") => ({ path: `worker://${W}/${folder}`, workerId: W, worker: "m1mini", folder, status });

// Every item, with a submenu's own items in place.
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((i) => ("submenu" in i ? flat(i.submenu) : [i]));

async function open(pick: string | null, synced = false, submenus = true) {
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  (window as unknown as { weft: unknown }).weft = { popupMenu, ...(submenus ? { menuSubmenus: true } : {}) };
  const deps = {
    projects: [project("/dev/p"), project(`worker://${W}/p`, "online"), project(`worker://${W}/other`, "offline")],
    cards: [],
    projectOf: (cwd: string) => cwd,
    workerProjects: [wproject("p", "online"), wproject("other", "offline")],
    openNew: vi.fn(),
    chooseProject: vi.fn(),
    openDrawer: vi.fn(),
    archive: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    syncFolders: synced ? ["/dev/p"] : [],
    syncStatus: status,
    readSync: vi.fn(() => Promise.resolve({ folders: synced ? ["/dev/p"] : [], status })),
    shareBoard: vi.fn(),
  } satisfies ProjectMenuDeps;
  await projectMenuHandler(deps)("/dev/p", { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
  await new Promise((r) => setTimeout(r, 0));
  const pulls = flat(popupMenu.mock.calls[0]?.[0] ?? []).filter((i) => "id" in i && i.id.startsWith("pull-wip:"));
  return { deps, pulls };
}

afterEach(() => {
  vi.clearAllMocks();
  twins.myDevices.mockResolvedValue([WORKER]);
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("Bring Uncommitted Work Here", () => {
  it("is offered for the worker project with this project's folder name, and no other", async () => {
    expect((await open(null)).pulls).toEqual([{ id: `pull-wip:worker://${W}/p`, label: "Bring Its Uncommitted Work Here", enabled: true }]);
    expect(api.pullWip).not.toHaveBeenCalled();
  });

  it("names the machine on each item when the shell can't draw submenus", async () => {
    expect((await open(null, false, false)).pulls).toEqual([{ id: `pull-wip:worker://${W}/p`, label: "Bring m1mini's Uncommitted Work Here", enabled: true }]);
  });

  it("pulls into this project, saying it asked and then what came", async () => {
    const { deps } = await open(`pull-wip:worker://${W}/p`);
    expect(api.pullWip).toHaveBeenCalledWith("/dev/p", `worker://${W}/p`, undefined);
    expect(deps.toast.mock.calls).toEqual([["Asking for its uncommitted work…"], ["Pulled 2 files of uncommitted work from m1mini."]]);
  });

  it("reports a pull that was refused", async () => {
    api.pullWip.mockRejectedValueOnce(new Error("This Mac has uncommitted work of its own in main."));
    const { deps } = await open(`pull-wip:worker://${W}/p`);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "This Mac has uncommitted work of its own in main." }));
  });
});

describe("Bring Uncommitted Work Here from another Mac", () => {
  const MAC = `mac:${"b".repeat(16)}/p`;
  const studio = device({ id: "studio", name: "Studio", host: "b".repeat(16) });

  it("is offered for a synced project, and not for one that isn't synced", async () => {
    twins.myDevices.mockResolvedValue([WORKER, studio]);
    expect((await open(null, true)).pulls.filter((i) => "id" in i && i.id.includes("mac:"))).toEqual([{ id: `pull-wip:${MAC}`, label: "Bring Its Uncommitted Work Here", enabled: true }]);
    expect((await open(null, false)).pulls.filter((i) => "id" in i && i.id.includes("mac:"))).toEqual([]);
  });

  it("signs the ask over this project's GitHub repo and the Mac's name, then pulls with it", async () => {
    twins.myDevices.mockResolvedValue([WORKER, studio]);
    const { deps } = await open(`pull-wip:${MAC}`, true);
    expect(twins.signMacAsk).toHaveBeenCalledWith("b".repeat(16), "p", "me/p", "Studio");
    expect(api.pullWip).toHaveBeenCalledWith("/dev/p", MAC, { origin: "me/p", mac: "Studio", widen: { kind: "ed25519" } });
    expect(deps.toast.mock.calls).toEqual([["Asking for its uncommitted work…"], ["Pulled 2 files of uncommitted work from m1mini."]]);
  });

  it("says so when the project has no GitHub remote, asking nothing", async () => {
    twins.myDevices.mockResolvedValue([WORKER, studio]);
    api.repos.mockResolvedValueOnce({ repos: [{ path: "/dev/p" }] });
    const { deps } = await open(`pull-wip:${MAC}`, true);
    expect(deps.toast).toHaveBeenCalledWith("p has no GitHub remote to meet your other Mac on.");
    expect(twins.signMacAsk).not.toHaveBeenCalled();
    expect(api.pullWip).not.toHaveBeenCalled();
  });

  it("pulls nothing when Touch ID is refused", async () => {
    twins.myDevices.mockResolvedValue([WORKER, studio]);
    twins.signMacAsk.mockRejectedValueOnce(new Error("Touch ID was cancelled"));
    const { deps } = await open(`pull-wip:${MAC}`, true);
    expect(api.pullWip).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Touch ID was cancelled" }));
  });
});

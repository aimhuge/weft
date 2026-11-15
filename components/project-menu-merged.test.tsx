// @vitest-environment jsdom
// A project chip merged with a Weft Worker's twin: the menu counts the worker's cards, lists the worker, and stops them
// through their host (lib/worker-twin.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "@/lib/card-menu";
import { makeCard } from "./test-utils";
import { projectMenuHandler, type ProjectMenuDeps } from "./project-menu-handler";

vi.mock("@/lib/client", () => ({
  api: { workerFolders: vi.fn(() => Promise.resolve({ folders: [] })), repos: vi.fn(() => Promise.resolve({ repos: [] })) },
}));
vi.mock("@/lib/mac-twins", () => ({ myDevices: vi.fn(() => Promise.resolve([])), signMacAsk: vi.fn() }));
const stopNow = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/optimistic-cards", () => ({ stopNow }));
const hostAct = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/lib/project-host", () => ({ hostOf: () => ({ act: hostAct }) }));
vi.mock("@/lib/changelog-open", () => ({ openChangelog: vi.fn() }));

const W = "0f8c2a1e-7b3d-4c5e-9a6f-1b2c3d4e5f60";
const status = { waiting: 0, lastSyncAt: null, uploaded: 0, lastError: null, signedOut: false, noWorkspace: false };
afterEach(() => delete (window as unknown as { weft?: unknown }).weft);

describe("a project merged with its worker twin", () => {
  it("lists the worker, counts its cards, and stops them through their host", async () => {
    const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve("stop-running"));
    (window as unknown as { weft: unknown }).weft = { popupMenu };
    const wpath = `worker://${W}/P`;
    const deps = {
      projects: [{ path: "/dev/p", lastActivity: 0, cards: 2, running: 2, needsYou: 0 }],
      cards: [makeCard({ id: "l", cwd: "/dev/p", column: "running" }), makeCard({ id: "w", cwd: wpath, column: "running" })],
      projectOf: (cwd: string) => (cwd === wpath ? "/dev/p" : cwd),
      workerProjects: [{ path: wpath, workerId: W, worker: "m1mini", folder: "P", status: "offline" as const }],
      openNew: vi.fn(), chooseProject: vi.fn(), openDrawer: vi.fn(), archive: vi.fn(), toast: vi.fn(), notify: vi.fn(),
      syncFolders: [], syncStatus: status, readSync: vi.fn(() => Promise.resolve({ folders: [], status })), shareBoard: vi.fn(),
    } satisfies ProjectMenuDeps;
    await projectMenuHandler(deps)("/dev/p", { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
    await new Promise((r) => setTimeout(r, 0));
    const menu = popupMenu.mock.calls[0]![0];
    expect(JSON.stringify(menu)).toContain("m1mini");
    expect(menu).toEqual(expect.arrayContaining([expect.objectContaining({ id: "stop-running", label: "Stop All 2 Running" })]));
    expect(stopNow).toHaveBeenCalledWith("l");
    expect(stopNow).toHaveBeenCalledWith("w", expect.any(Function));
    await (stopNow.mock.calls as unknown as [string, () => Promise<void>][]).find((c) => c[0] === "w")![1]();
    expect(hostAct).toHaveBeenCalledWith("card.stop", { id: "w" });
  });
});

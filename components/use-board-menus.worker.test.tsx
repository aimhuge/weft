// @vitest-environment jsdom
// A worker card's right-click menu on the desktop board (components/use-board-menus.ts): only what a worker backs
// (lib/card-menu-remote.ts), and each pick sent to it as a `host` command (lib/project-host.ts).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "@/lib/card-menu";
import { forget } from "@/lib/optimistic-cards";
import { useBoardMenus, type BoardMenuDeps } from "./use-board-menus";
import { makeCard } from "./test-utils";

const api = vi.hoisted(() => ({ devStatus: vi.fn(), mark: vi.fn(), stop: vi.fn(), switchBackend: vi.fn(), setMode: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/client", () => ({ api }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());
vi.mock("@/lib/api-client", () => ({ API_HEADERS: {}, apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const card = makeCard({ cwd: "worker://w1/ling", column: "running" });

function setup(pick: string | null) {
  const popupMenu = vi.fn<(items: MenuItem[]) => Promise<string | null>>(() => Promise.resolve(pick));
  const vault = { grants: vi.fn(() => Promise.resolve([])), grant: vi.fn() };
  (window as unknown as { weft: unknown }).weft = { popupMenu, vault };
  const deps = {
    doneShown: [], archivedCount: 0, showArchived: false, openCard: vi.fn(), renameCard: vi.fn(), move: vi.fn(), toggleArchive: vi.fn(),
    archive: vi.fn(), remove: vi.fn(), openNew: vi.fn(), toggleArchived: vi.fn(), toast: vi.fn(), notify: vi.fn(),
  } satisfies BoardMenuDeps;
  let menus: ReturnType<typeof useBoardMenus> | null = null;
  function Probe() {
    menus = useBoardMenus(deps);
    return null;
  }
  render(<Probe />);
  const open = () => act(async () => {
    await menus!.onCardMenu(card, { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
  });
  return { popupMenu, vault, deps, open };
}

// The `host` commands sent to /api/worker-board.
const hostSent = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === "/api/worker-board" && init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url) => Promise.resolve(json(url.startsWith("/api/workers") ? { status: "done", error: null } : { commandId: "cmd-1" })));
});

afterEach(() => {
  forget(card.id);
  cleanup();
  vi.clearAllMocks();
});

describe("a worker card's menu", () => {
  it("offers what a worker backs, Run /<skill> too, and not its agent, folder, vault, share or delete", async () => {
    const { popupMenu, vault, open } = setup(null);
    await open();
    const ids = popupMenu.mock.calls[0]![0].flatMap((item) => ("id" in item ? [item.id] : []));
    expect(ids).toEqual(expect.arrayContaining(["open", "rename", "stop", "star", "tags", "archive", "mode:acceptEdits", "skill:weft:done"]));
    for (const gone of ["delete", "share", "reveal", "copy-path", "mode:bypassPermissions"]) expect(ids).not.toContain(gone);
    expect(ids.some((id) => id.startsWith("agent:"))).toBe(false);
    // Nothing of this Mac's is read for a worker's card.
    expect(vault.grants).not.toHaveBeenCalled();
    expect(api.devStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["star", { verb: "card.update", args: { id: "c1", body: { starred: true } } }],
    ["mode:acceptEdits", { verb: "card.update", args: { id: "c1", body: { permissionMode: "acceptEdits" } } }],
    ["switch:codex", { verb: "card.switchBackend", args: { id: "c1", backend: "codex", replay: false } }],
    ["stop", { verb: "card.stop", args: { id: "c1" } }],
    // A skill is a message: "/<skill>" through card.message, never this Mac's send.
    ["skill:weft:done", { verb: "card.message", args: { id: "c1", text: "/weft:done" } }],
  ])("%s goes to the worker as a host command", async (pick, sent) => {
    const { open } = setup(pick);
    await open();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hostSent()).toEqual([{ action: "host", cardId: "c1", ...sent }]);
    expect(api.mark).not.toHaveBeenCalled();
    expect(api.stop).not.toHaveBeenCalled();
    expect(api.switchBackend).not.toHaveBeenCalled();
    expect(api.setMode).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
  });
});

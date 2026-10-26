import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardActions } from "./board-tools";
import type { Spec } from "./runner-state";

// Weft's own MCP servers for a thread. Each call builds fresh servers, since an MCP server instance
// serves one connection; the card is read when a tool runs, since a spare CLI only gets its card
// later. A thread gets the vault, the webhooks, the dev servers, the board window and the phone
// simulators; the copilot runs the board, not a project, so it gets none of those.

// Each fake keeps the real factory's parameters, so the mock's recorded calls carry the arguments
// the server was built with (the card reader, the folder readers).
const servers = vi.hoisted(() => ({
  browser: vi.fn<(cardId: () => string | undefined) => { kind: string }>(() => ({ kind: "browser" })),
  board: vi.fn<(actions: BoardActions) => { kind: string }>(() => ({ kind: "board" })),
  weft: vi.fn<(cardId: () => string | undefined, actions: Pick<BoardActions, "start">, cwd?: () => string) => { kind: string }>(() => ({ kind: "weft" })),
  boardView: vi.fn(() => ({ kind: "boardView" })),
  devservers: vi.fn<(cardId: () => string | undefined, cwd: () => string) => { kind: string }>(() => ({ kind: "devservers" })),
  secrets: vi.fn<(cardId: () => string | undefined, folder: () => string, title?: () => string | undefined) => { kind: string }>(() => ({ kind: "secrets" })),
  simulator: vi.fn<(cardId: () => string | undefined) => { kind: string }>(() => ({ kind: "simulator" })),
  webhooks: vi.fn<(folder: () => string) => { kind: string }>(() => ({ kind: "webhooks" })),
}));

vi.mock("./browser-tools", () => ({ browserMcpServer: servers.browser }));
vi.mock("./board-tools", () => ({ boardMcpServer: servers.board, weftMcpServer: servers.weft }));
vi.mock("./board-view-tools", () => ({ boardViewMcpServer: servers.boardView }));
vi.mock("./devserver-tools", () => ({ devserversMcpServer: servers.devservers }));
vi.mock("./secret-tools", () => ({ secretsMcpServer: servers.secrets }));
vi.mock("./simulator-tools", () => ({ simulatorMcpServer: servers.simulator }));
vi.mock("./webhook-tools", () => ({ webhooksMcpServer: servers.webhooks }));
vi.mock("./store", () => ({
  // Read at import by the modules runner-state.ts pulls in (lib/attachments.ts).
  DATA_DIR: "/tmp/weft-api-test-data",
  getCard: vi.fn(() => ({ id: "c1", title: "A card" })),
}));

const { weftMcpServers } = await import("./weft-mcp");
const store = await import("./store");
const { hooks } = await import("./runner-state");
// lib/runner.ts fills in the board's actions when it loads; it isn't loaded here, so a stand-in.
const boardActions = { start: vi.fn() } as unknown as BoardActions;
hooks.boardActions = boardActions;

const spec = (over: Partial<Spec> = {}): Spec =>
  ({ cwd: "/repo/app", backend: "claude", permissionMode: "default", ...over }) as Spec;

beforeEach(() => vi.clearAllMocks());

describe("weftMcpServers", () => {
  it("gives a thread the browser, the vault, the webhooks, the dev servers, the board window, the simulators and the board", () => {
    const built = weftMcpServers(spec(), () => "c1");
    expect(Object.keys(built).sort()).toEqual(
      ["board", "board_view", "browser", "devservers", "secrets", "simulator", "webhooks"].sort(),
    );
    expect(built.browser).toEqual({ kind: "browser" });
    expect(built.secrets).toEqual({ kind: "secrets" });
    expect(built.webhooks).toEqual({ kind: "webhooks" });
    expect(built.devservers).toEqual({ kind: "devservers" });
    expect(built.board_view).toEqual({ kind: "boardView" });
    expect(built.simulator).toEqual({ kind: "simulator" });
    expect(built.board).toEqual({ kind: "weft" });
  });

  it("gives the copilot the browser and the board, and none of the project's servers", () => {
    const built = weftMcpServers(spec({ copilot: true }), () => "c1");
    expect(Object.keys(built).sort()).toEqual(["board", "browser"]);
    expect(built.board).toEqual({ kind: "board" });
  });

  it("passes the card through to the servers that need it", () => {
    weftMcpServers(spec(), () => "c1");
    expect(servers.browser).toHaveBeenCalledWith(expect.any(Function));
    expect(servers.secrets).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.any(Function));
    expect(servers.devservers).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    expect(servers.simulator).toHaveBeenCalledWith(expect.any(Function));
    // The board server gets the card reader, the board's actions, and the folder it works in.
    const boardArgs = servers.weft.mock.calls[0]!;
    expect(boardArgs[0]).toBeInstanceOf(Function);
    expect(boardArgs[2]).toBeInstanceOf(Function);
    expect(boardArgs[1]).toBe(boardActions);
  });

  it("reads the card when a tool runs, so a spare CLI gets its card later", () => {
    const cardId = vi.fn(() => "c1");
    weftMcpServers(spec(), cardId);
    cardId.mockReturnValue("c2");
    // The server was handed a reader, not the card's id: the card is read when a tool runs.
    expect(servers.browser.mock.calls[0]?.[0]).toBe(cardId);
    expect(servers.browser.mock.calls[0]?.[0]?.()).toBe("c2");
  });

  it("passes no card to a CLI that doesn't have one yet", () => {
    const cardId = vi.fn(() => undefined);
    weftMcpServers(spec(), cardId);
    expect(servers.browser.mock.calls[0]?.[0]?.()).toBeUndefined();
  });

  it("gives the webhooks and the vault the project's folder when the card runs in a worktree", () => {
    weftMcpServers(spec({ project: "/repo" }), () => "c1");
    // The webhooks live per project, not per worktree.
    expect(servers.webhooks.mock.calls[0]?.[0]?.()).toBe("/repo");
  });

  it("falls back to the card's own folder when there is no project", () => {
    weftMcpServers(spec(), () => "c1");
    expect(servers.webhooks.mock.calls[0]?.[0]?.()).toBe("/repo/app");
  });

  it("builds fresh servers on every call, since one server serves one connection", () => {
    const first = weftMcpServers(spec(), () => "c1");
    const second = weftMcpServers(spec(), () => "c2");
    expect(first.browser).not.toBe(second.browser);
    expect(servers.browser).toHaveBeenCalledTimes(2);
  });

  // The servers ask for the card's title and its folder when a tool runs, not when they are built.
  it("reads the card's title for the vault, and its folder, when a tool runs", () => {
    weftMcpServers(spec(), () => "c1");
    // The vault's folder reader.
    const folder = servers.secrets.mock.calls[0]?.[1];
    expect(folder?.()).toBe("/repo/app");
    // The vault's title reader.
    const title = servers.secrets.mock.calls[0]?.[2];
    expect(title?.()).toBe("A card");
    // The dev servers' folder reader.
    const devFolder = servers.devservers.mock.calls[0]?.[1];
    expect(devFolder?.()).toBe("/repo/app");
  });

  it("reads the project's folder for the webhooks, and the card's own folder without a project", () => {
    weftMcpServers(spec({ project: "/repo" }), () => "c1");
    const webhooksFolder = servers.webhooks.mock.calls[0]?.[0];
    expect(webhooksFolder?.()).toBe("/repo");
  });

  // The board server works in the project's folder, so a card in a worktree still changes the
  // project's changelog.
  it("gives the board the project's folder, or the card's own when there is none", () => {
    weftMcpServers(spec({ project: "/repo" }), () => "c1");
    const boardFolder = servers.weft.mock.calls[0]?.[2];
    expect(boardFolder?.()).toBe("/repo");
    vi.clearAllMocks();
    weftMcpServers(spec(), () => "c1");
    const ownFolder = servers.weft.mock.calls[0]?.[2];
    expect(ownFolder?.()).toBe("/repo/app");
  });

  it("reads no title when the card isn't known yet", () => {
    vi.mocked(store.getCard).mockReturnValueOnce(undefined);
    weftMcpServers(spec(), () => undefined);
    const title = servers.secrets.mock.calls[0]?.[2];
    expect(title?.()).toBeUndefined();
  });
});

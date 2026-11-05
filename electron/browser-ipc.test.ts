// electron/browser-ipc.cjs: the board's browser pane IPC. A fake ipcMain records the handlers; the pane stub what got through.
import { describe, expect, it, vi } from "vitest";
import registerBrowserIpc from "./browser-ipc.cjs";

type Handler = (...args: unknown[]) => unknown;

function setup() {
  const handlers = new Map<string, Handler>();
  const ipcMain = { handle: (c: string, fn: Handler) => handlers.set(c, fn), on: (c: string, fn: Handler) => handlers.set(c, fn) };
  const board = { id: 1 };
  const pane = {
    open: vi.fn(() => Promise.resolve({ url: "https://a.co" })),
    state: vi.fn(() => ({ url: "" })),
    setVisible: vi.fn(),
    setActive: vi.fn(),
    prune: vi.fn(),
    setBounds: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    zoom: vi.fn(),
    find: vi.fn(),
    stopFind: vi.fn(),
  };
  registerBrowserIpc({ ipcMain, pane, getBoardContents: () => board });
  return { call: (c: string, ...args: unknown[]) => handlers.get(c)!(...args), board, pane };
}

describe("registerBrowserIpc", () => {
  it("opens pages for the board only, and hands back a load error rather than throwing", async () => {
    const { call, board, pane } = setup();
    await expect(call("browser:open", { sender: board }, "a.co", "card-1")).resolves.toEqual({ url: "https://a.co" });
    expect(pane.open).toHaveBeenCalledWith("a.co", "card-1", true, { fromBoard: true });
    await call("browser:open", { sender: board }, "a.co", "");
    expect(pane.open).toHaveBeenLastCalledWith("a.co", undefined, true, { fromBoard: true });
    pane.open.mockRejectedValueOnce(new Error("nope"));
    await expect(call("browser:open", { sender: board }, "x")).resolves.toEqual({ error: "nope" });
    pane.open.mockRejectedValueOnce("plain");
    await expect(call("browser:open", { sender: board }, "x")).resolves.toEqual({ error: "plain" });
    expect(call("browser:open", { sender: { id: 2 } }, "x")).toEqual({ error: "Browser pane only answers the board window." });
    expect(pane.open).toHaveBeenCalledTimes(4);
  });

  it("passes the toolbar's controls through", () => {
    const { call, pane } = setup();
    expect(call("browser:state")).toEqual({ url: "" });
    call("browser:visible", {}, 1);
    call("browser:active", {}, "card-1");
    call("browser:prune", {}, ["a"]);
    call("browser:prune", {}, "junk");
    call("browser:back");
    call("browser:forward");
    call("browser:reload");
    call("browser:zoom", {}, "in");
    expect(pane.setVisible).toHaveBeenCalledWith(true);
    expect(pane.setActive).toHaveBeenCalledWith("card-1");
    expect(pane.prune.mock.calls).toEqual([[["a"]], [[]]]);
    expect(pane.back).toHaveBeenCalled();
    expect(pane.forward).toHaveBeenCalled();
    expect(pane.reload).toHaveBeenCalled();
    expect(pane.zoom).toHaveBeenCalledWith("in");
  });

  it("scales the placeholder's box by the board's zoom", () => {
    const { call, pane } = setup();
    call("browser:bounds", { sender: { getZoomFactor: () => 1.5 } }, { x: 10, y: 20, width: 100, height: 200 });
    expect(pane.setBounds).toHaveBeenCalledWith({ x: 15, y: 30, width: 150, height: 300 });
  });

  it("finds in the page for the board's find bar only", () => {
    const { call, board, pane } = setup();
    call("browser:find", { sender: board }, "hooks");
    call("browser:find", { sender: board }, "hooks", { forward: false, next: true });
    call("browser:find", { sender: board }, undefined);
    call("browser:stop-find", { sender: board });
    call("browser:find", { sender: { id: 2 } }, "x");
    call("browser:stop-find", {});
    expect(pane.find.mock.calls).toEqual([
      ["hooks", { forward: true, next: false }],
      ["hooks", { forward: false, next: true }],
      ["", { forward: true, next: false }],
    ]);
    expect(pane.stopFind).toHaveBeenCalledTimes(1);
  });
});

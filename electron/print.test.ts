import { describe, expect, it, vi } from "vitest";

const { setupPrint, printHtml } = await import("./print.cjs");

function fakeWindow(ok: boolean, reason = "") {
  const win = {
    loadURL: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
    webContents: { print: vi.fn((_opts: unknown, cb: (ok: boolean, reason: string) => void) => cb(ok, reason)) },
  };
  const BrowserWindow = vi.fn(function () {
    return win;
  });
  return { win, BrowserWindow };
}

function setup(isBoard = true) {
  const handlers: Record<string, (e: unknown, ...args: unknown[]) => unknown> = {};
  const ipcMain = { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => (handlers[channel] = fn) };
  const { win, BrowserWindow } = fakeWindow(true);
  setupPrint({ ipcMain, BrowserWindow, isBoard: () => isBoard });
  const call = (channel: string, e: unknown, ...args: unknown[]) => {
    const fn = handlers[channel];
    if (!fn) throw new Error(`no handler for ${channel}`);
    return fn(e, ...args);
  };
  return { call, win, BrowserWindow };
}

describe("printHtml", () => {
  it("loads the sheet in a hidden window with no script, prints it and closes the window", async () => {
    const { win, BrowserWindow } = fakeWindow(true);
    expect(await printHtml({ BrowserWindow }, "<p>a b</p>")).toEqual({ ok: true });
    expect(BrowserWindow).toHaveBeenCalledWith({ show: false, webPreferences: { javascript: false, sandbox: true } });
    expect(win.loadURL).toHaveBeenCalledWith("data:text/html;charset=utf-8,%3Cp%3Ea%20b%3C%2Fp%3E");
    expect(win.webContents.print.mock.calls[0]?.[0]).toMatchObject({ silent: false, landscape: true });
    expect(win.destroy).toHaveBeenCalled();
  });
  it("says why when the print didn't happen", async () => {
    expect(await printHtml(fakeWindow(false, "Print job canceled"), "x")).toEqual({ ok: false, reason: "Print job canceled" });
    expect(await printHtml(fakeWindow(false), "x")).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("setupPrint", () => {
  it("lists the board's printers by display name", async () => {
    const { call } = setup();
    const sender = { getPrintersAsync: () => Promise.resolve([{ name: "HP_1", displayName: "Office HP" }, { name: "Brother" }]) };
    expect(await call("print:printers", { sender })).toEqual(["Office HP", "Brother"]);
  });
  it("lists none when macOS can't say", async () => {
    const { call } = setup();
    expect(await call("print:printers", { sender: { getPrintersAsync: () => Promise.reject(new Error("x")) } })).toEqual([]);
  });
  it("answers only the board window", async () => {
    const { call, BrowserWindow } = setup(false);
    expect(await call("print:printers", { sender: {} })).toEqual([]);
    expect(await call("print:html", { sender: {} }, "<p>x</p>")).toMatchObject({ ok: false });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
  it("prints the board's html and refuses an empty page", async () => {
    const { call, win } = setup();
    expect(await call("print:html", { sender: {} }, "")).toEqual({ ok: false, reason: "Nothing to print." });
    expect(await call("print:html", { sender: {} }, "<p>x</p>")).toEqual({ ok: true });
    expect(win.webContents.print).toHaveBeenCalledTimes(1);
  });
});

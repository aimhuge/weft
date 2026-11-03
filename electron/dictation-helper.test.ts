import { afterEach, describe, expect, it, vi } from "vitest";

const { createDictationHelper, pillBounds, DEFAULT_SHORTCUT, PILL } = await import("./dictation-helper.cjs");

type Fn = (...args: unknown[]) => unknown;

function fakePill() {
  const winEvents: Record<string, Fn> = {};
  const pageEvents: Record<string, Fn> = {};
  let visible = false;
  let destroyed = false;
  const win = {
    winEvents,
    pageEvents,
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setBounds: vi.fn(),
    showInactive: vi.fn(() => (visible = true)),
    hide: vi.fn(() => (visible = false)),
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    destroy: vi.fn(() => (destroyed = true)),
    loadURL: vi.fn(() => Promise.resolve()),
    on: (event: string, cb: Fn) => (winEvents[event] = cb),
    webContents: { on: (event: string, cb: Fn) => (pageEvents[event] = cb), send: vi.fn() },
  };
  return win;
}

const workArea = { x: 100, y: 25, width: 1440, height: 875 };

interface Opts {
  server?: { url: string } | null;
  mac?: boolean | undefined;
}

function setup(opts: Opts = {}) {
  const { server = { url: "http://127.0.0.1:5001" } } = opts;
  const mac = "mac" in opts ? opts.mac : true;
  const pills: ReturnType<typeof fakePill>[] = [];
  const BrowserWindow = vi.fn<(opts: Record<string, unknown>) => ReturnType<typeof fakePill>>(function () {
    const win = fakePill();
    pills.push(win);
    return win;
  });
  const keys: Record<string, Fn> = {};
  const globalShortcut = {
    register: vi.fn((accel: string, cb: Fn) => {
      keys[accel] = cb;
      return true;
    }),
    unregister: vi.fn((accel: string) => Reflect.deleteProperty(keys, accel)),
  };
  const screen = { getCursorScreenPoint: vi.fn(() => ({ x: 5, y: 5 })), getDisplayNearestPoint: vi.fn(() => ({ workArea })) };
  const on: Record<string, Fn> = {};
  const handle: Record<string, Fn> = {};
  const ipcMain = { on: (ch: string, fn: Fn) => (on[ch] = fn), handle: (ch: string, fn: Fn) => (handle[ch] = fn) };
  const box = { server };
  const getServer = vi.fn(() => box.server);
  const deliver = vi.fn<(text: string) => Promise<string>>(() => Promise.resolve("pasted"));
  const broadcast = vi.fn();
  const deps = { BrowserWindow, globalShortcut, screen, ipcMain, getServer, deliver, broadcast };
  const helper = createDictationHelper(mac === undefined ? deps : { ...deps, mac });
  const pill = () => pills[pills.length - 1]!;
  const fromPill = (p = pill()) => ({ sender: p.webContents });
  return { helper, pills, pill, fromPill, BrowserWindow, globalShortcut, keys, screen, on, handle, box, deliver, broadcast };
}

afterEach(() => vi.restoreAllMocks());

describe("pillBounds", () => {
  it("centres the pill at the top of the work area under the mouse", () => {
    const { screen } = setup();
    expect(pillBounds(screen)).toEqual({ x: 100 + (1440 - PILL.width) / 2, y: 33, ...PILL });
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 5, y: 5 });
  });
  it("rounds an odd centre", () => {
    const screen = { getCursorScreenPoint: () => ({}), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 241, height: 1 } }) };
    expect(pillBounds(screen).x).toBe(1);
  });
});

describe("toggle", () => {
  it("does nothing without a server", () => {
    const { helper, BrowserWindow } = setup({ server: null });
    helper.toggle();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
  it("creates the pill, shows it in place and queues the toggle until the page loads", () => {
    const { helper, pill, BrowserWindow } = setup();
    helper.toggle();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    const opts = BrowserWindow.mock.calls[0]![0];
    expect(opts).toMatchObject({ ...PILL, show: false, focusable: false, alwaysOnTop: true, type: "panel" });
    const p = pill();
    expect(p.loadURL).toHaveBeenCalledWith("http://127.0.0.1:5001/dictate");
    expect(p.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(p.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    expect(p.setBounds).toHaveBeenCalledWith({ x: 700, y: 33, ...PILL });
    expect(p.showInactive).toHaveBeenCalled();
    expect(p.webContents.send).not.toHaveBeenCalled();
    p.pageEvents["did-finish-load"]!();
    expect(p.webContents.send).toHaveBeenCalledWith("dictation:command", "toggle");
    helper.toggle();
    expect(p.webContents.send).toHaveBeenCalledTimes(2);
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
  });
  it("doesn't reposition a pill that's already showing", () => {
    const { helper, pill } = setup();
    helper.toggle();
    helper.toggle();
    expect(pill().setBounds).toHaveBeenCalledTimes(1);
    expect(pill().showInactive).toHaveBeenCalledTimes(1);
  });
  it("is no panel off macOS, and defaults mac to the platform", () => {
    const off = setup({ mac: false });
    off.helper.toggle();
    expect(off.BrowserWindow.mock.calls[0]![0]).not.toHaveProperty("type");
    const auto = setup({ mac: undefined });
    auto.helper.toggle();
    expect((auto.BrowserWindow.mock.calls[0]![0] as { type?: string }).type).toBe(process.platform === "darwin" ? "panel" : undefined);
  });
  it("recreates the pill when an idle toggle finds the server on another url", () => {
    const { helper, pills, box, BrowserWindow } = setup();
    helper.toggle();
    const old = pills[0]!;
    box.server = { url: "http://127.0.0.1:5002" };
    helper.toggle();
    expect(old.destroy).toHaveBeenCalled();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
    const next = pills[1]!;
    expect(next.loadURL).toHaveBeenCalledWith("http://127.0.0.1:5002/dictate");
    // The old pill's late events don't touch the new one.
    old.pageEvents["did-finish-load"]!();
    expect(old.webContents.send).not.toHaveBeenCalled();
    old.winEvents.closed!();
    next.pageEvents["did-finish-load"]!();
    expect(next.webContents.send).toHaveBeenCalledWith("dictation:command", "toggle");
    helper.toggle();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
  });
  it("keeps a recording pill across a server move", () => {
    const { helper, pill, on, fromPill, box, BrowserWindow } = setup();
    helper.toggle();
    on["dictation:state"]!(fromPill(), { state: "recording" });
    box.server = { url: "http://127.0.0.1:5002" };
    helper.toggle();
    expect(pill().destroy).not.toHaveBeenCalled();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
  });
  it("keeps the warm pill when the server is down", () => {
    const { helper, pill, box, BrowserWindow } = setup();
    helper.toggle();
    box.server = null;
    helper.toggle();
    expect(pill().destroy).not.toHaveBeenCalled();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
  });
  it("recreates a pill that was destroyed", () => {
    const { helper, pills, BrowserWindow } = setup();
    helper.toggle();
    pills[0]!.destroy();
    helper.toggle();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
  });
});

describe("setShortcut", () => {
  it("registers the default for an empty key and toggles on press", () => {
    const { helper, globalShortcut, keys, BrowserWindow } = setup();
    expect(helper.setShortcut("")).toBe(true);
    expect(globalShortcut.register).toHaveBeenCalledWith(DEFAULT_SHORTCUT, expect.any(Function));
    keys[DEFAULT_SHORTCUT]!();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
  });
  it("keeps the same key without registering again", () => {
    const { helper, globalShortcut } = setup();
    helper.setShortcut("Alt+D");
    expect(helper.setShortcut("Alt+D")).toBe(true);
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
  });
  it("unregisters the old key on a change", () => {
    const { helper, globalShortcut } = setup();
    helper.setShortcut("Alt+D");
    expect(helper.setShortcut("Alt+E")).toBe(true);
    expect(globalShortcut.unregister).toHaveBeenCalledWith("Alt+D");
    expect(globalShortcut.register).toHaveBeenLastCalledWith("Alt+E", expect.any(Function));
  });
  it("says no when the key is taken or invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { helper, globalShortcut } = setup();
    globalShortcut.register.mockReturnValueOnce(false);
    expect(helper.setShortcut("Alt+D")).toBe(false);
    globalShortcut.register.mockImplementationOnce(() => {
      throw new Error("bad accelerator");
    });
    expect(helper.setShortcut("Nope")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    // Nothing held, so the next change unregisters nothing.
    helper.setShortcut("Alt+E");
    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });
});

describe("ipc", () => {
  it("holds Escape only while recording, relays state and cancels on Escape", () => {
    const { helper, on, fromPill, globalShortcut, keys, broadcast, pill } = setup();
    helper.toggle();
    pill().pageEvents["did-finish-load"]!();
    on["dictation:state"]!(fromPill(), { state: "recording", seconds: 1 });
    expect(helper.state()).toBe("recording");
    expect(globalShortcut.register).toHaveBeenCalledWith("Escape", expect.any(Function));
    expect(broadcast).toHaveBeenCalledWith("dictation:state", { state: "recording", seconds: 1 });
    on["dictation:state"]!(fromPill(), { state: "recording", seconds: 2 });
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    keys.Escape!();
    expect(pill().webContents.send).toHaveBeenLastCalledWith("dictation:command", "cancel");
    on["dictation:state"]!(fromPill(), { state: "transcribing" });
    expect(globalShortcut.unregister).toHaveBeenCalledWith("Escape");
    on["dictation:state"]!(fromPill(), { state: "recording" });
    on["dictation:state"]!(fromPill(), undefined);
    expect(helper.state()).toBe("idle");
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(2);
  });
  it("ignores state from anything but the pill", () => {
    const { helper, on, broadcast, globalShortcut } = setup();
    on["dictation:state"]!({ sender: {} }, { state: "recording" });
    helper.toggle();
    on["dictation:state"]!({ sender: {} }, { state: "recording" });
    expect(helper.state()).toBe("idle");
    expect(broadcast).not.toHaveBeenCalled();
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });
  it("delivers the pill's text and copies anything else", async () => {
    const { helper, handle, fromPill, deliver } = setup();
    helper.toggle();
    expect(await handle["dictation:text"]!(fromPill(), "hello")).toBe("pasted");
    expect(deliver).toHaveBeenCalledWith("hello");
    expect(await handle["dictation:text"]!({ sender: {} }, "hello")).toBe("copied");
    expect(await handle["dictation:text"]!(fromPill(), "")).toBe("copied");
    expect(await handle["dictation:text"]!(fromPill(), 42)).toBe("copied");
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("hides only an idle pill, and only when the pill asks", () => {
    const { helper, on, fromPill, pill } = setup();
    helper.toggle();
    on["dictation:hide"]!({ sender: {} });
    expect(pill().hide).not.toHaveBeenCalled();
    on["dictation:state"]!(fromPill(), { state: "recording" });
    on["dictation:hide"]!(fromPill());
    expect(pill().hide).not.toHaveBeenCalled();
    on["dictation:state"]!(fromPill(), { state: "idle" });
    on["dictation:hide"]!(fromPill());
    expect(pill().hide).toHaveBeenCalled();
  });
  it("toggles, cancels and sets the shortcut from the board", () => {
    const { on, pill, globalShortcut, BrowserWindow } = setup();
    on["dictation:cancel"]!({});
    on["dictation:toggle"]!({});
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    pill().pageEvents["did-finish-load"]!();
    on["dictation:cancel"]!({});
    expect(pill().webContents.send).toHaveBeenLastCalledWith("dictation:command", "cancel");
    on["dictation:shortcut"]!({}, "Alt+D");
    expect(globalShortcut.register).toHaveBeenLastCalledWith("Alt+D", expect.any(Function));
    on["dictation:shortcut"]!({}, 7);
    expect(globalShortcut.register).toHaveBeenLastCalledWith(DEFAULT_SHORTCUT, expect.any(Function));
  });
});

describe("start and closed", () => {
  it("registers the default key and loads the pill once", () => {
    const { helper, BrowserWindow, pill, globalShortcut } = setup();
    helper.start();
    helper.start();
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(pill().showInactive).not.toHaveBeenCalled();
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(globalShortcut.register).toHaveBeenCalledWith(DEFAULT_SHORTCUT, expect.any(Function));
  });
  it("keeps a key the board sent before start", () => {
    const { helper, on, globalShortcut } = setup();
    on["dictation:shortcut"]!({}, "Alt+D");
    helper.start();
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(globalShortcut.unregister).not.toHaveBeenCalledWith("Alt+D");
  });
  it("loads nothing without a server", () => {
    const { helper, BrowserWindow } = setup({ server: null });
    helper.start();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
  it("resets to idle and lets Escape go when the pill closes", () => {
    const { helper, on, fromPill, pill, globalShortcut, BrowserWindow } = setup();
    helper.toggle();
    on["dictation:state"]!(fromPill(), { state: "recording" });
    pill().winEvents.closed!();
    expect(helper.state()).toBe("idle");
    expect(globalShortcut.unregister).toHaveBeenCalledWith("Escape");
    helper.start();
    expect(BrowserWindow).toHaveBeenCalledTimes(2);
  });
});

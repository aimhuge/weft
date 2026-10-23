import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPageSnapshot, snapshotRoutes } from "./page-snapshot.cjs";

// electron/page-snapshot.cjs: the app in a hidden, sandboxed window at 1200×630, captured once it has
// painted, for a mini app's link preview. BrowserWindow is injected (a fake class), so the test can
// check what the window was told to do: muted, no popups, no navigation off the app's origin, and the
// capture itself — resized to the wanted size, or nothing at all when the page painted nothing.

// How the next window behaves: the size the capture comes back at, whether the page painted anything,
// whether the capture itself fails, and the gate the capture waits on (the queue test).
interface Behaviour {
  size: { width: number; height: number };
  empty: boolean;
  captureThrows: boolean;
  resized: { width: number; height: number };
  gate: Promise<void> | null;
  captures: number;
}

const behaviour: Behaviour = {
  size: { width: 1200, height: 630 },
  empty: false,
  captureThrows: false,
  resized: { width: 0, height: 0 },
  gate: null,
  captures: 0,
};

class FakeWebContents {
  audioMuted = false;
  openHandler: ((details: unknown) => { action: string }) | null = null;
  handlers = new Map<string, (event: { preventDefault: () => void }, ...rest: unknown[]) => void>();

  setAudioMuted(value: boolean) {
    this.audioMuted = value;
  }

  setWindowOpenHandler(handler: (details: unknown) => { action: string }) {
    this.openHandler = handler;
  }

  on(event: string, handler: (event: { preventDefault: () => void }, ...rest: unknown[]) => void) {
    this.handlers.set(event, handler);
  }

  async capturePage() {
    behaviour.captures += 1;
    if (behaviour.gate) await behaviour.gate;
    if (behaviour.captureThrows) throw new Error("capture failed");
    const empty = behaviour.empty;
    const size = behaviour.size;
    const resized = behaviour.resized;
    return {
      isEmpty: () => empty,
      getSize: () => size,
      resize: (to: { width: number; height: number }) => {
        resized.width = to.width;
        resized.height = to.height;
        return {
          isEmpty: () => empty,
          getSize: () => to,
          resize: () => {
            throw new Error("already resized");
          },
          toPNG: () => Buffer.from("resized-png"),
        };
      },
      toPNG: () => Buffer.from("png-bytes"),
    };
  }

  navigate(event: { preventDefault: () => void }, next: string) {
    this.handlers.get("will-navigate")?.(event, next);
  }
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];
  options: Record<string, unknown>;
  webContents = new FakeWebContents();
  loadedUrl: string | null = null;
  destroyed = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeBrowserWindow.instances.push(this);
  }

  loadURL(url: string) {
    this.loadedUrl = url;
    return Promise.resolve();
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }
}

const BrowserWindow = FakeBrowserWindow as unknown as new (options: Record<string, unknown>) => FakeBrowserWindow;

// A snapshot with no waiting: settleMs and timeoutMs of 0, so the capture happens right away.
const FAST = { url: "https://example.com/app", width: 1200, height: 630, settleMs: 0, timeoutMs: 0 };

beforeEach(() => {
  FakeBrowserWindow.instances = [];
  behaviour.size = { width: 1200, height: 630 };
  behaviour.empty = false;
  behaviour.captureThrows = false;
  behaviour.resized = { width: 0, height: 0 };
  behaviour.gate = null;
  behaviour.captures = 0;
});

describe("createPageSnapshot", () => {
  it("captures the page as a base64 png, in a hidden, sandboxed, muted window", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    const out = await snapshot(FAST);
    expect(out).toEqual({ png: Buffer.from("png-bytes").toString("base64") });

    const win = FakeBrowserWindow.instances[0];
    if (!win) throw new Error("no window was created");
    expect(win.options).toMatchObject({ show: false, width: 1200, height: 630, useContentSize: true });
    expect(win.options.webPreferences).toMatchObject({
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: "weft-snapshot",
    });
    expect(win.webContents.audioMuted).toBe(true);
    expect(win.loadedUrl).toBe("https://example.com/app");
    expect(win.destroyed).toBe(true);
  });

  it("refuses a page that isn't http, https or a file", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await expect(snapshot({ ...FAST, url: "javascript:alert(1)" })).rejects.toThrow(/Only http, https and file/);
    await expect(snapshot({ ...FAST, url: "ftp://example.com" })).rejects.toThrow(/Only http, https and file/);
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  it("refuses an address it can't parse", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await expect(snapshot({ ...FAST, url: "not a url" })).rejects.toThrow(/Only http, https and file/);
    expect(FakeBrowserWindow.instances).toHaveLength(0);
  });

  it("clamps the size, and falls back when it wasn't a number", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await snapshot({ ...FAST, width: 10, height: 10 });
    expect(FakeBrowserWindow.instances[0]?.options).toMatchObject({ width: 320, height: 200 });

    FakeBrowserWindow.instances = [];
    await snapshot({ ...FAST, width: 99999, height: 99999 });
    expect(FakeBrowserWindow.instances[0]?.options).toMatchObject({ width: 1600, height: 1200 });

    FakeBrowserWindow.instances = [];
    await snapshot({ ...FAST, width: "wide", height: "tall" });
    expect(FakeBrowserWindow.instances[0]?.options).toMatchObject({ width: 1200, height: 630 });
  });

  it("denies a window the page tries to open", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await snapshot(FAST);
    const win = FakeBrowserWindow.instances[0];
    const handler = win?.webContents.openHandler;
    if (!handler) throw new Error("no window-open handler was registered");
    expect(handler({ url: "https://elsewhere.test" })).toEqual({ action: "deny" });
  });

  it("stops a jump to another origin, but lets one inside the app through", async () => {
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await snapshot(FAST);
    const win = FakeBrowserWindow.instances[0];
    if (!win) throw new Error("no window was created");

    let prevented = false;
    const event = { preventDefault: () => { prevented = true; } };
    win.webContents.navigate(event, "https://elsewhere.test/login");
    expect(prevented).toBe(true);

    prevented = false;
    win.webContents.navigate(event, "https://example.com/other");
    expect(prevented).toBe(false);

    prevented = false;
    win.webContents.navigate(event, "not a url");
    expect(prevented).toBe(true);
  });

  it("has no picture when the page painted nothing", async () => {
    behaviour.empty = true;
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    expect(await snapshot(FAST)).toEqual({ png: null });
  });

  it("resizes the picture when it isn't the size that was asked for", async () => {
    behaviour.size = { width: 800, height: 600 };
    behaviour.resized = { width: 0, height: 0 };
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    const out = await snapshot(FAST);
    expect(behaviour.resized).toEqual({ width: 1200, height: 630 });
    expect(out).toEqual({ png: Buffer.from("resized-png").toString("base64") });
  });

  it("destroys the window even when the capture fails", async () => {
    behaviour.captureThrows = true;
    const { snapshot } = createPageSnapshot({ BrowserWindow });
    await expect(snapshot(FAST)).rejects.toThrow("capture failed");
    expect(FakeBrowserWindow.instances[0]?.destroyed).toBe(true);
  });

  it("captures anyway when the page wouldn't load", async () => {
    // A page that never loads is still captured, as far as it painted.
    class BrokenWindow extends FakeBrowserWindow {
      override loadURL(): Promise<void> {
        return Promise.reject(new Error("ERR_NAME_NOT_RESOLVED"));
      }
    }
    const { snapshot } = createPageSnapshot({ BrowserWindow: BrokenWindow as never });
    await expect(snapshot(FAST)).resolves.toEqual({ png: Buffer.from("png-bytes").toString("base64") });
  });

  it("doesn't destroy a window that is already gone", async () => {
    // The page closed itself (a window.open that wasn't allowed, say): the window is already
    // destroyed, and destroying it again would throw.
    class GoneWindow extends FakeBrowserWindow {
      override isDestroyed() {
        return true;
      }
    }
    const { snapshot } = createPageSnapshot({ BrowserWindow: GoneWindow as never });
    await expect(snapshot(FAST)).resolves.toEqual({ png: Buffer.from("png-bytes").toString("base64") });
    expect(FakeBrowserWindow.instances[0]?.destroyed).toBe(false);
  });

  it("takes one capture at a time: the second waits for the first", async () => {
    // The first capture waits at the gate: the second one can't start until it is let go.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    behaviour.gate = gate;

    const { snapshot } = createPageSnapshot({ BrowserWindow });
    const first = snapshot(FAST);
    const second = snapshot(FAST);
    await vi.waitFor(() => expect(behaviour.captures).toBe(1));
    release();
    await first;
    await vi.waitFor(() => expect(behaviour.captures).toBe(2));
    release();
    await second;
    expect(behaviour.captures).toBe(2);
  });
});

describe("snapshotRoutes", () => {
  it("makes the snapper once, on first use", async () => {
    const getSnapper = vi.fn(() => ({ snapshot: vi.fn(() => Promise.resolve({ png: "x" })) }));
    const routes = snapshotRoutes(getSnapper) as Record<string, (body: unknown) => unknown>;
    expect(Object.keys(routes)).toEqual(["POST /page/snapshot"]);
    expect(getSnapper).not.toHaveBeenCalled();

    await routes["POST /page/snapshot"]!({ url: "https://example.com" });
    await routes["POST /page/snapshot"]!({ url: "https://example.com" });
    expect(getSnapper).toHaveBeenCalledTimes(1);
  });
});

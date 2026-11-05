import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanInput, findSource, INPUT_PATH, onViewerPage, pickWindow, sendInput, setupSimLive } from "./sim-live.cjs";

// The simulator live view's door into main: which window to capture, and the taps it sends on. What makes it
// safe is pinned here: only the pane's main frame on a page under show/simulator/ gets an answer, only known
// fields cross to the server, and the launch token goes from main, never through the page.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-live-"));
const viewer = path.join(dataDir, "show", "simulator", "SIM-1", "index.html");
fs.mkdirSync(path.dirname(viewer), { recursive: true });
fs.writeFileSync(viewer, "<p>");
const other = path.join(dataDir, "show", "plan.html");
fs.writeFileSync(other, "<p>");
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const src = (name: string, id = name) => ({ id: `window:${id}`, name });

describe("pickWindow", () => {
  it("takes the window titled with the device's name", () => {
    expect(pickWindow([src("Weft"), src("iPhone 17 Pro")], "iPhone 17 Pro")?.name).toBe("iPhone 17 Pro");
  });

  it("finds the emulator's window by its AVD name", () => {
    expect(pickWindow([src("Android Emulator - Weft_Pixel_9:5554")], "Weft Pixel 9")?.name).toContain("Weft_Pixel_9");
  });

  it("doesn't give a shorter name a longer device's window", () => {
    expect(pickWindow([src("iPhone 17 Pro")], "iPhone 17")).toBeNull();
    expect(pickWindow([src("iPhone 17 Pro"), src("iPhone 17")], "iPhone 17")?.name).toBe("iPhone 17");
  });

  it("finds nothing for an empty name", () => {
    expect(pickWindow([src("iPhone")], "")).toBeNull();
  });
});

describe("onViewerPage", () => {
  const event = (file: string) => ({ sender: { getURL: () => pathToFileURL(file).href } });
  it("accepts a page the watch wrote and nothing else", () => {
    expect(onViewerPage(dataDir, event(viewer))).toBe(true);
    expect(onViewerPage(dataDir, event(other))).toBe(false);
    expect(onViewerPage(dataDir, { sender: { getURL: () => "https://example.com/" } })).toBe(false);
    expect(onViewerPage(dataDir, { sender: { getURL: () => { throw new Error("gone"); } } })).toBe(false);
  });
});

describe("findSource", () => {
  const apis = (access: string, sources = [src("iPhone 16")]) => ({
    systemPreferences: { getMediaAccessStatus: () => access },
    desktopCapturer: { getSources: vi.fn(() => Promise.resolve(sources)) },
  });

  it("returns the window to capture", async () => {
    expect(await findSource(apis("granted"), "iPhone 16")).toEqual({ ok: true, id: "window:iPhone 16", name: "iPhone 16" });
  });

  it("says permission when Screen Recording is off", async () => {
    const a = apis("denied");
    expect(await findSource(a, "iPhone 16")).toEqual({ ok: false, reason: "permission" });
    expect(a.desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it("says no-window when the device's window isn't there", async () => {
    expect(await findSource(apis("granted", []), "iPhone 16")).toEqual({ ok: false, reason: "no-window" });
    expect(await findSource(apis("not-determined", []), "iPhone 16")).toEqual({ ok: false, reason: "permission" });
  });
});

describe("cleanInput", () => {
  it("keeps the known fields and drops the rest", () => {
    expect(cleanInput({ kind: "tap", device: "SIM-1", x: 0.5, y: Number.NaN, url: "http://x" })).toEqual({ kind: "tap", device: "SIM-1", x: 0.5 });
  });

  it("refuses an unknown kind", () => {
    expect(() => cleanInput({ kind: "shell" })).toThrow(/Unknown input/);
  });
});

describe("sendInput", () => {
  it("posts to Weft's own server with the launch token", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }));
    const out = await sendInput({ server: () => ({ url: "http://127.0.0.1:1024", token: "T" }), fetch }, { kind: "tap", device: "SIM-1", x: 0.1, y: 0.2 });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`http://127.0.0.1:1024${INPUT_PATH}`);
    expect(init.headers).toMatchObject({ "x-weft-token": "T" });
  });

  it("passes the server's error on", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "not watched" }) }));
    expect(await sendInput({ server: () => ({ url: "http://127.0.0.1:1024", token: "T" }), fetch }, { kind: "live", device: "SIM-1" })).toEqual({ ok: false, error: "not watched" });
  });

  it("says so when the server isn't up", async () => {
    expect(await sendInput({ server: () => null, fetch: vi.fn() }, { kind: "live", device: "SIM-1" })).toEqual({ ok: false, error: "Weft's server isn't running." });
  });
});

describe("setupSimLive", () => {
  const wire = () => {
    const handlers = new Map<string, (event: unknown, arg: unknown) => unknown>();
    const fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const apis = () => ({ systemPreferences: { getMediaAccessStatus: () => "granted" }, desktopCapturer: { getSources: () => Promise.resolve([src("iPhone 16")]) } });
    setupSimLive({ ipcMain: { handle: (c: string, fn: (event: unknown, arg: unknown) => unknown) => void handlers.set(c, fn) }, owns: () => true, dataDir, server: () => ({ url: "http://127.0.0.1:1", token: "T" }), apis, fetch });
    return { handlers, fetch };
  };
  const event = (file: string, mainFrame = true) => {
    const frame = {};
    return { sender: { getURL: () => pathToFileURL(file).href, mainFrame: frame }, senderFrame: mainFrame ? frame : {} };
  };

  it("answers Weft's viewer page", async () => {
    const { handlers } = wire();
    expect(await handlers.get("sim-live:source")!(event(viewer), "iPhone 16")).toMatchObject({ ok: true });
    expect(await handlers.get("sim-live:input")!(event(viewer), { kind: "live", device: "SIM-1" })).toEqual({ ok: true });
  });

  it("refuses any other page, and an iframe on the viewer", () => {
    const { handlers, fetch } = wire();
    expect(() => handlers.get("sim-live:source")!(event(other), "iPhone 16")).toThrow(/simulator view/);
    expect(() => handlers.get("sim-live:input")!(event(viewer, false), { kind: "tap", device: "SIM-1" })).toThrow(/simulator view/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

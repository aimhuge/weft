import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ANDROID, IOS, resetFakes, type Result } from "./simulator-tools.harness";

// The tools that read and touch what is on the screen, the picture of it, and the live view of it.
const devices = vi.hoisted(() => ({ listDevices: vi.fn(), bootedDevice: vi.fn(), boot: vi.fn(), install: vi.fn(), launch: vi.fn(), openUrl: vi.fn(), screenshot: vi.fn(), logs: vi.fn() }));
const ui = vi.hoisted(() => ({ uiTree: vi.fn(), tapAt: vi.fn(), swipe: vi.fn(), typeText: vi.fn(), press: vi.fn() }));
const watch = vi.hoisted(() => ({ watch: vi.fn(), watching: vi.fn(), writeFrame: vi.fn() }));
const openInPane = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./simulator-tools.harness")).sdkMock());
vi.mock("./simulator-devices", async () => (await import("./simulator-tools.harness")).devicesMock(devices));
vi.mock("./simulator-ui", async () => (await import("./simulator-tools.harness")).uiMock(ui));
vi.mock("./simulator-watch", async () => (await import("./simulator-tools.harness")).watchMock(watch));
vi.mock("./browser-tools", async () => (await import("./simulator-tools.harness")).browserToolsMock(openInPane));

const st = await import("./simulator-tools");

let card: string | undefined = "c1";
const server = st.simulatorMcpServer(() => card) as unknown as { name: string; alwaysLoad: boolean; tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<Result> }> };
const run = (name: string, args: Record<string, unknown> = {}) => server.tools.find((t) => t.name === name)!.handler(args);
const said = (r: Result) => r.content[0]?.text;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-screen-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A tiny real PNG, so the screenshot tool can read its size and shrink it.
const PNG = await sharp({ create: { width: 60, height: 120, channels: 3, background: "#336699" } }).png().toBuffer();

beforeEach(() => {
  vi.clearAllMocks();
  card = "c1";
  resetFakes(devices, ui, watch, openInPane, PNG);
});

describe("ui_tree", () => {
  it("lists the labelled elements with their index, type and frame", async () => {
    ui.uiTree.mockResolvedValue([
      { index: 0, type: "Button", label: "Continue", id: "next", value: "", frame: { x: 10, y: 20, width: 100, height: 40 } },
      { index: 1, type: "TextField", label: "Email", id: "", value: "", frame: { x: 10, y: 80, width: 200, height: 30 } },
    ]);
    const r = await run("ui_tree");
    expect(said(r)).toBe(['[0] Button "Continue" #next (10,20 100x40)', '[1] TextField "Email" (10,80 200x30)'].join("\n"));
  });

  it("leaves out the elements with nothing to say", async () => {
    ui.uiTree.mockResolvedValue([{ index: 0, type: "View", label: "", id: "", value: "", frame: { x: 0, y: 0, width: 0, height: 0 } }]);
    expect(said(await run("ui_tree"))).toBe("Nothing labelled on screen (the app may still be loading).");
  });

  it("turns a failure into an error result", async () => {
    ui.uiTree.mockRejectedValue(new Error("axe missing"));
    expect(await run("ui_tree")).toMatchObject({ isError: true, content: [{ text: "axe missing" }] });
  });
});

describe("tap", () => {
  const els = [{ index: 0, type: "Button", label: "Continue", id: "next", value: "", frame: { x: 10, y: 20, width: 100, height: 40 } }];

  it("taps the element's centre and says which element", async () => {
    ui.uiTree.mockResolvedValue(els);
    const r = await run("tap", { element: "Continue" });
    expect(ui.tapAt).toHaveBeenCalledWith(IOS, 60, 40);
    expect(said(r)).toBe('Tapped [0] Button "Continue" #next (10,20 100x40)');
  });

  it("taps by x and y when no element is given", async () => {
    const r = await run("tap", { x: 12, y: 34 });
    expect(ui.tapAt).toHaveBeenCalledWith(IOS, 12, 34);
    expect(said(r)).toBe("Tapped 12,34");
  });

  it("asks for an element or both coordinates", async () => {
    expect(await run("tap")).toMatchObject({ isError: true, content: [{ text: "Give element, or both x and y." }] });
    expect(await run("tap", { x: 12 })).toMatchObject({ isError: true, content: [{ text: "Give element, or both x and y." }] });
    expect(ui.tapAt).not.toHaveBeenCalled();
  });

  it("says nothing on screen matches when the element isn't there", async () => {
    ui.uiTree.mockResolvedValue(els);
    expect(await run("tap", { element: "Nope" })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/Nothing on screen matches "Nope"/) as unknown }] });
  });
});

describe("swipe", () => {
  const els = [{ index: 0, type: "Window", label: "", id: "", value: "", frame: { x: 0, y: 0, width: 400, height: 800 } }];

  it("swipes across the screen in the direction it is given", async () => {
    ui.uiTree.mockResolvedValue(els);
    const r = await run("swipe", { direction: "up" });
    expect(ui.swipe).toHaveBeenCalledWith(IOS, { x: 200, y: 640 }, { x: 200, y: 160 });
    expect(said(r)).toBe("Swiped up");
  });

  it("swipes from one point to another", async () => {
    const r = await run("swipe", { from_x: 1, from_y: 2, to_x: 3, to_y: 4 });
    expect(ui.swipe).toHaveBeenCalledWith(IOS, { x: 1, y: 2 }, { x: 3, y: 4 });
    expect(said(r)).toBe("Swiped 1,2 → 3,4");
  });

  it("asks for a direction or all four coordinates", async () => {
    expect(await run("swipe")).toMatchObject({ isError: true, content: [{ text: "Give direction, or from_x, from_y, to_x and to_y." }] });
    expect(await run("swipe", { from_x: 1, from_y: 2, to_x: 3 })).toMatchObject({ isError: true, content: [{ text: "Give direction, or from_x, from_y, to_x and to_y." }] });
    expect(ui.swipe).not.toHaveBeenCalled();
  });

  it("turns a failure into an error result", async () => {
    ui.uiTree.mockResolvedValue([]);
    expect(await run("swipe", { direction: "up" })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/screen's size/) as unknown }] });
  });
});

describe("type_text", () => {
  it("types into whatever is focused", async () => {
    const r = await run("type_text", { text: "hello" });
    expect(ui.typeText).toHaveBeenCalledWith(IOS, "hello");
    expect(said(r)).toBe("Typed 5 characters");
  });

  it("taps the field first and says which one", async () => {
    ui.uiTree.mockResolvedValue([{ index: 0, type: "TextField", label: "Email", id: "mail", value: "", frame: { x: 0, y: 0, width: 200, height: 40 } }]);
    const r = await run("type_text", { text: "hi", element: "Email" });
    expect(ui.tapAt).toHaveBeenCalledWith(IOS, 100, 20);
    expect(ui.typeText).toHaveBeenCalledWith(IOS, "hi");
    expect(said(r)).toBe("Typed 2 characters into Email");
  });

  it("turns a failure into an error result", async () => {
    ui.typeText.mockRejectedValue(new Error("keyboard busy"));
    expect(await run("type_text", { text: "hi" })).toMatchObject({ isError: true, content: [{ text: "keyboard busy" }] });
  });
});

describe("press", () => {
  it("presses the key", async () => {
    const r = await run("press", { key: "home" });
    expect(ui.press).toHaveBeenCalledWith(IOS, "home");
    expect(said(r)).toBe("Pressed home");
  });

  it("turns a failure into an error result", async () => {
    ui.press.mockRejectedValue(new Error("iOS has no back button"));
    expect(await run("press", { key: "back" })).toMatchObject({ isError: true, content: [{ text: "iOS has no back button" }] });
  });
});

describe("screenshot", () => {
  it("returns the screen as an image, shrunk to a height that reads well", async () => {
    const r = await run("screenshot");
    expect(r.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    const small = Buffer.from(r.content[0]!.data!, "base64");
    const meta = await sharp(small).metadata();
    expect(meta.width).toBe(60);
    expect(meta.height).toBe(120);
  });

  it("says how big the screen is and what units its coordinates are in", async () => {
    const r = await run("screenshot");
    expect(r.content[1]).toMatchObject({ type: "text" });
    expect(r.content[1]!.text).toContain("iPhone 16: 60x120 px screen");
    expect(r.content[1]!.text).toContain("points (screen pixels ÷ the device's scale, 3 on most iPhones)");
  });

  it("calls an Android screen's coordinates pixels", async () => {
    devices.bootedDevice.mockResolvedValue(ANDROID);
    expect((await run("screenshot")).content[1]!.text).toContain("Taps by coordinate are in screen pixels");
  });

  it("saves the full-size PNG when it is given a path", async () => {
    const file = path.join(tmp, "shots", "screen.png");
    const r = await run("screenshot", { save_to: file });
    expect(r.content[2]).toEqual({ type: "text", text: `Saved to ${file}` });
    const meta = await sharp(fs.readFileSync(file)).metadata();
    expect([meta.width, meta.height]).toEqual([60, 120]);
  });

  it("turns a failure into an error result", async () => {
    devices.screenshot.mockRejectedValue(new Error("no device"));
    expect(await run("screenshot")).toMatchObject({ isError: true, content: [{ text: "no device" }] });
  });
});

describe("logs", () => {
  it("returns the device's log lines", async () => {
    const r = await run("logs");
    expect(devices.logs).toHaveBeenCalledWith(IOS, { app: undefined, lines: undefined, since: undefined });
    expect(said(r)).toBe("line one\nline two");
  });

  it("asks for one app's logs and how many lines", async () => {
    await run("logs", { app: "com.example.app", lines: 20, since: "5m" });
    expect(devices.logs).toHaveBeenCalledWith(IOS, { app: "com.example.app", lines: 20, since: "5m" });
  });

  it("says there were none when the device gave nothing", async () => {
    devices.logs.mockResolvedValue("");
    expect(said(await run("logs"))).toBe("No log lines.");
  });

  it("turns a failure into an error result", async () => {
    devices.logs.mockRejectedValue(new Error("app isn't running"));
    expect(await run("logs")).toMatchObject({ isError: true, content: [{ text: "app isn't running" }] });
  });
});

describe("watch", () => {
  it("shows the device in the card's browser pane", async () => {
    const r = await run("watch");
    expect(watch.watch).toHaveBeenCalledWith(IOS);
    expect(openInPane).toHaveBeenCalledWith("file:///show/simulator/SIM-1/index.html", "c1");
    expect(said(r)).toBe("Watching iPhone 16 in the browser pane: file:///show/simulator/SIM-1/index.html");
  });

  it("gives the url and leaves opening it to the thread when the card has no pane", async () => {
    card = undefined;
    const r = await run("watch");
    expect(openInPane).not.toHaveBeenCalled();
    expect(said(r)).toBe("Live view at file:///show/simulator/SIM-1/index.html; open it with mcp__browser__open_url.");
  });

  it("turns a failure into an error result", async () => {
    watch.watch.mockRejectedValue(new Error("no device"));
    expect(await run("watch")).toMatchObject({ isError: true, content: [{ text: "no device" }] });
  });
});

describe("after an action", () => {
  it("writes a fresh frame when the device is being watched", async () => {
    watch.watching.mockReturnValue(true);
    await run("press", { key: "home" });
    expect(watch.writeFrame).toHaveBeenCalledWith(IOS);
  });

  it("writes no frame when nothing is watching the device", async () => {
    await run("press", { key: "home" });
    expect(watch.writeFrame).not.toHaveBeenCalled();
  });

  it("still says what it did when the refresh fails", async () => {
    watch.watching.mockReturnValue(true);
    watch.writeFrame.mockRejectedValue(new Error("pane gone"));
    expect(said(await run("press", { key: "home" }))).toBe("Pressed home");
  });
});

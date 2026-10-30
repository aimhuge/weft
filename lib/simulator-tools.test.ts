import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ANDROID, IOS, resetFakes, type Result } from "./simulator-tools.harness";

// The device the tools drive, and the fakes standing in for the device, the screen and the live view.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-tools-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A tiny real PNG, so the screenshot tool can read its size and shrink it.
const PNG = await sharp({ create: { width: 60, height: 120, channels: 3, background: "#336699" } }).png().toBuffer();

beforeEach(() => {
  vi.clearAllMocks();
  card = "c1";
  resetFakes(devices, ui, watch, openInPane, PNG);
});

describe("SIMULATOR_PROMPT", () => {
  it("tells the thread to ask before installing anything itself", () => {
    expect(st.SIMULATOR_PROMPT).toContain("ask before installing anything yourself");
  });

  it("names the tools a thread drives a device with", () => {
    for (const name of ["list_devices", "boot", "install", "launch", "ui_tree", "tap", "type_text", "swipe", "watch", "screenshot"]) {
      expect(st.SIMULATOR_PROMPT).toContain(name);
    }
  });

  it("offers a React Native app's web build before booting a device", () => {
    expect(st.SIMULATOR_PROMPT).toContain("npx expo start --web");
    expect(st.SIMULATOR_PROMPT).toContain("set_viewport phone");
    expect(st.SIMULATOR_PROMPT.indexOf("--web")).toBeLessThan(st.SIMULATOR_PROMPT.indexOf("list_devices"));
  });

  it("points at Settings → Connectors → Simulators when a toolchain is missing", () => {
    expect(st.SIMULATOR_PROMPT).toContain("Settings → Connectors → Simulators");
  });
});

describe("simulatorMcpServer", () => {
  it("is the always-loaded simulator server with every device tool", () => {
    expect(server.name).toBe("simulator");
    expect(server.alwaysLoad).toBe(true);
    expect(server.tools.map((t) => t.name)).toEqual([
      "list_devices",
      "boot",
      "install",
      "launch",
      "open_url",
      "ui_tree",
      "tap",
      "swipe",
      "type_text",
      "press",
      "screenshot",
      "logs",
      "watch",
    ]);
  });
});

describe("list_devices", () => {
  it("names each device with its state, platform, runtime and id", async () => {
    const r = await run("list_devices");
    expect(said(r)).toBe(
      ["● iPhone 16 · iOS 18.2 · booted · SIM-1", "● Pixel 9 · android · booted · emulator-5554", "○ Tablet · android · shutdown · avd:Tablet"].join("\n"),
    );
  });

  it("says where to look when there are no devices", async () => {
    devices.listDevices.mockResolvedValue([]);
    const r = await run("list_devices");
    expect(said(r)).toContain("No simulators or emulators found");
    expect(said(r)).toContain("Settings → Connectors → Simulators");
  });

  it("turns a failure into an error result", async () => {
    devices.listDevices.mockRejectedValue(new Error("xcrun missing"));
    expect(await run("list_devices")).toMatchObject({ isError: true, content: [{ text: "xcrun missing" }] });
  });
});

describe("boot", () => {
  it("boots the named device and says so", async () => {
    const r = await run("boot", { device: "SIM-1" });
    expect(devices.boot).toHaveBeenCalledWith("SIM-1");
    expect(said(r)).toBe("Booted ● iPhone 16 · iOS 18.2 · booted · SIM-1");
  });

  it("turns a failure into an error result", async () => {
    devices.boot.mockRejectedValue(new Error("no runtime"));
    expect(await run("boot", { device: "X" })).toMatchObject({ isError: true, content: [{ text: "no runtime" }] });
  });
});

describe("install", () => {
  it("installs the app on the booted device and says which", async () => {
    const r = await run("install", { path: "/apps/Demo.app" });
    expect(devices.install).toHaveBeenCalledWith(IOS, "/apps/Demo.app");
    expect(said(r)).toBe("Installed /apps/Demo.app on iPhone 16");
  });

  it("installs on the device it is told to", async () => {
    devices.bootedDevice.mockResolvedValue(ANDROID);
    await run("install", { path: "/apps/demo.apk", device: "emulator-5554" });
    expect(devices.bootedDevice).toHaveBeenCalledWith("emulator-5554");
    expect(devices.install).toHaveBeenCalledWith(ANDROID, "/apps/demo.apk");
  });

  it("turns a failure into an error result", async () => {
    devices.install.mockRejectedValue(new Error("No app at /apps/Demo.app"));
    expect(await run("install", { path: "/apps/Demo.app" })).toMatchObject({ isError: true, content: [{ text: "No app at /apps/Demo.app" }] });
  });
});

describe("launch", () => {
  it("launches the app and names it", async () => {
    const r = await run("launch", { app: "com.example.app" });
    expect(devices.launch).toHaveBeenCalledWith(IOS, "com.example.app");
    expect(said(r)).toBe("Launched com.example.app on iPhone 16");
  });

  it("adds what the device said about the launch", async () => {
    devices.launch.mockResolvedValue("pid: 1234");
    expect(said(await run("launch", { app: "com.example.app" }))).toBe("Launched com.example.app on iPhone 16: pid: 1234");
  });

  it("turns a failure into an error result", async () => {
    devices.launch.mockRejectedValue(new Error("not installed"));
    expect(await run("launch", { app: "x" })).toMatchObject({ isError: true, content: [{ text: "not installed" }] });
  });
});

describe("open_url", () => {
  it("opens the url on the device and says so", async () => {
    const r = await run("open_url", { url: "https://a.test" });
    expect(devices.openUrl).toHaveBeenCalledWith(IOS, "https://a.test");
    expect(said(r)).toBe("Opened https://a.test on iPhone 16");
  });

  it("turns a failure into an error result", async () => {
    devices.openUrl.mockRejectedValue(new Error("bad url"));
    expect(await run("open_url", { url: "x" })).toMatchObject({ isError: true, content: [{ text: "bad url" }] });
  });
});

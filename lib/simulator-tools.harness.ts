// The fake device the simulator tools tests share (lib/simulator-tools.test.ts, lib/simulator-tools-screen.test.ts).
// A test file makes the shared state with vi.hoisted and hands it to the mock factories the harness exports:
//   vi.mock("./simulator-devices", async () => (await import("./simulator-tools.harness")).devicesMock(devices));
import { vi } from "vitest";

export type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
export type Handler = (args: Record<string, unknown>) => Promise<Result>;

// The device a thread drives. One booted iPhone, one booted Android, one that is off.
export const IOS = { id: "SIM-1", name: "iPhone 16", platform: "ios" as const, state: "booted" as const, runtime: "iOS 18.2" };
export const ANDROID = { id: "emulator-5554", name: "Pixel 9", platform: "android" as const, state: "booted" as const };
export const OFF = { id: "avd:Tablet", name: "Tablet", platform: "android" as const, state: "shutdown" as const };

// The device layer: every call is recorded, so a test can see what a tool asked the device to do.
export function devicesState() {
  return {
    listDevices: vi.fn(),
    bootedDevice: vi.fn(),
    boot: vi.fn(),
    install: vi.fn(),
    launch: vi.fn(),
    openUrl: vi.fn(),
    screenshot: vi.fn(),
    logs: vi.fn(),
  };
}

// The screen helpers that touch the device.
export function uiState() {
  return { uiTree: vi.fn(), tapAt: vi.fn(), swipe: vi.fn(), typeText: vi.fn(), press: vi.fn() };
}

// The live view: watching says whether a device is on screen, watch starts it, writeFrame refreshes it.
export function watchState() {
  return { watch: vi.fn(), watching: vi.fn(), writeFrame: vi.fn() };
}

export type Devices = ReturnType<typeof devicesState>;
export type Ui = ReturnType<typeof uiState>;
export type Watch = ReturnType<typeof watchState>;

// The mocks the test files wire into vi.mock.
export const devicesMock = (devices: Devices) => devices;

export const uiMock = async (ui: Ui) => {
  // The pure helpers (describe, findElement, center, named…) stay real; only the device calls are faked.
  const actual = await vi.importActual<typeof import("./simulator-ui")>("./simulator-ui");
  return { ...actual, ...ui };
};

export const watchMock = (watch: Watch) => watch;

// The browser pane's opener is the only piece of the browser tools that reaches out; the rest stays real.
export const browserToolsMock = async (openInPane: ReturnType<typeof vi.fn>) => {
  const actual = await vi.importActual<typeof import("./browser-tools")>("./browser-tools");
  return { ...actual, openInPane };
};

// The SDK's MCP server builder, captured so a test can call the tools directly.
export const sdkMock = () => ({
  createSdkMcpServer: (options: { name: string; alwaysLoad?: boolean; tools: Array<{ name: string; handler: Handler }> }) => options,
  tool: (name: string, _description: string, _schema: unknown, handler: Handler) => ({ name, handler }),
});

// Puts every fake back to its starting point, so each test starts from a known device.
export function resetFakes(devices: Devices, ui: Ui, watch: Watch, openInPane: ReturnType<typeof vi.fn>, png: Buffer) {
  devices.listDevices.mockResolvedValue([IOS, ANDROID, OFF]);
  devices.bootedDevice.mockResolvedValue(IOS);
  devices.boot.mockResolvedValue(IOS);
  devices.install.mockResolvedValue(undefined);
  devices.launch.mockResolvedValue("");
  devices.openUrl.mockResolvedValue(undefined);
  devices.screenshot.mockResolvedValue(png);
  devices.logs.mockResolvedValue("line one\nline two");
  ui.uiTree.mockResolvedValue([]);
  ui.tapAt.mockResolvedValue(undefined);
  ui.swipe.mockResolvedValue(undefined);
  ui.typeText.mockResolvedValue(undefined);
  ui.press.mockResolvedValue(undefined);
  watch.watch.mockResolvedValue("file:///show/simulator/SIM-1/index.html");
  watch.watching.mockReturnValue(false);
  watch.writeFrame.mockResolvedValue(undefined);
  openInPane.mockResolvedValue(undefined);
}

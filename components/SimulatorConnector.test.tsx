// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulatorStatus } from "@/lib/simulator-view";
import "./test-utils";
import SimulatorConnector from "./SimulatorConnector";

// Settings → Connectors → Simulators: the panel that lists what the threads' simulator tools have on this Mac.
// The client call is mocked, so what these tests pin is the panel's own behaviour: the three load states, the
// ok and missing rows, and the Copy, Open and Check again buttons.

const api = vi.hoisted(() => ({
  call: vi.fn<(method: string, url: string) => Promise<SimulatorStatus>>(),
}));
vi.mock("@/lib/client", () => ({ call: api.call }));

const openExternal = vi.fn();

const OK: SimulatorStatus = {
  checks: [
    { key: "xcode", platform: "ios", label: "Xcode", ok: true, detail: "/Applications/Xcode.app" },
    { key: "axe", platform: "ios", label: "AXe (taps, typing, UI tree)", ok: false, detail: "Not installed", fix: { text: "Install with Homebrew", command: "brew install cameroncooke/axe/axe" } },
    { key: "xcode-select", platform: "ios", label: "Xcode selected", ok: false, detail: "No developer folder", fix: { text: "Point the command-line tools at Xcode", command: "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" } },
    { key: "studio", platform: "android", label: "Android Studio", ok: false, detail: "Missing", fix: { text: "Download Android Studio", url: "https://developer.android.com/studio" } },
    { key: "avd", platform: "android", label: "A virtual device", ok: true, detail: "Pixel_8_API_34" },
  ],
  devices: 1,
};

function setup(status: SimulatorStatus = OK) {
  api.call.mockResolvedValue(status);
  render(<SimulatorConnector titleClass="title" hintClass="hint" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.weft = { openExternal } as unknown as typeof window.weft;
});

describe("SimulatorConnector", () => {
  it("looks for the tools while it loads", async () => {
    api.call.mockReturnValue(new Promise(() => {}));
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    expect(await screen.findByText(/Looking for Xcode and the Android SDK/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeDisabled();
  });

  it("asks the server for the simulator status", async () => {
    setup();
    await waitFor(() => expect(api.call).toHaveBeenCalled());
    expect(api.call).toHaveBeenCalledWith("GET", "/api/connectors/simulators");
  });

  it("shows the error when the call fails", async () => {
    api.call.mockRejectedValue(new Error("simctl isn't on this Mac's PATH."));
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    expect(await screen.findByText("simctl isn't on this Mac's PATH.")).toBeInTheDocument();
  });

  it("falls back to the string when the failure isn't an Error", async () => {
    api.call.mockRejectedValue("offline");
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    expect(await screen.findByText("offline")).toBeInTheDocument();
  });

  it("lists the ok and missing rows under their platform", async () => {
    setup();
    expect(await screen.findByText("Xcode")).toBeInTheDocument();
    expect(screen.getByText("/Applications/Xcode.app")).toBeInTheDocument();
    expect(screen.getByText("AXe (taps, typing, UI tree)")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
    expect(screen.getByText("iOS")).toBeInTheDocument();
    expect(screen.getByText("Android")).toBeInTheDocument();
    expect(screen.getByText("Android Studio")).toBeInTheDocument();
    expect(screen.getByText("Pixel_8_API_34")).toBeInTheDocument();
  });

  it("says how many devices it found", async () => {
    setup();
    expect(await screen.findByText(/1 device found\./)).toBeInTheDocument();
  });

  it("pluralises the device count", async () => {
    setup({ checks: [], devices: 2 });
    expect(await screen.findByText(/2 devices found\./)).toBeInTheDocument();
  });

  it("shows no fix for a piece that's there", async () => {
    setup({ checks: [{ key: "xcode", platform: "ios", label: "Xcode", ok: true, detail: "/Applications/Xcode.app" }], devices: 0 });
    expect(await screen.findByText("Xcode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("copies the command and says it did", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup({ checks: [{ key: "axe", platform: "ios", label: "AXe (taps, typing, UI tree)", ok: false, detail: "Not installed", fix: { text: "Install with Homebrew", command: "brew install cameroncooke/axe/axe" } }], devices: 0 });
    const copy = await screen.findByRole("button", { name: "Copy" });
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("brew install cameroncooke/axe/axe");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("opens the download link outside the app", async () => {
    setup({ checks: [{ key: "studio", platform: "android", label: "Android Studio", ok: false, detail: "Missing", fix: { text: "Download Android Studio", url: "https://developer.android.com/studio" } }], devices: 0 });
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(openExternal).toHaveBeenCalledWith("https://developer.android.com/studio");
  });

  it("checks again when asked", async () => {
    setup();
    await screen.findByText("Xcode");
    expect(api.call).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(api.call).toHaveBeenCalledTimes(2));
  });
});

// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstallJob, SimulatorStatus } from "@/lib/simulator-view";
import "./test-utils";
import SimulatorConnector from "./SimulatorConnector";

// Settings → Connectors → Simulators: the panel that lists what the threads' simulator tools have on this Mac.
// The client call is mocked, so what these tests pin is the panel's own behaviour: the three load states, the
// ok and missing rows, and the Install, Open and Check again buttons.

const api = vi.hoisted(() => ({
  call: vi.fn<(method: string, url: string, body?: unknown) => Promise<unknown>>(),
}));
vi.mock("@/lib/client", () => ({ call: api.call }));

const openExternal = vi.fn();

const OK: SimulatorStatus = {
  checks: [
    { key: "xcode", platform: "ios", label: "Xcode", ok: true, detail: "/Applications/Xcode.app" },
    { key: "axe", platform: "ios", label: "AXe (taps, typing, UI tree)", ok: false, detail: "Not installed", fix: { text: "Into ~/.weft/tools, from its GitHub release", install: "axe" } },
    { key: "xcode-select", platform: "ios", label: "Xcode selected", ok: false, detail: "No developer folder", fix: { text: "Point the command-line tools at Xcode", command: "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer", install: "xcode-select" } },
    { key: "studio", platform: "android", label: "Android Studio", ok: false, detail: "Missing", fix: { text: "Download Android Studio", url: "https://developer.android.com/studio" } },
    { key: "avd", platform: "android", label: "A virtual device", ok: true, detail: "Pixel_8_API_34" },
  ],
  devices: 1,
};

const ANDROID_ROWS: SimulatorStatus = {
  checks: [
    { key: "sdk", platform: "android", label: "Android SDK", ok: false, detail: "Not found", fix: { text: "The SDK, adb, the emulator and a Pixel 9", install: "android" } },
    { key: "adb", platform: "android", label: "adb", ok: false, detail: "Not found", fix: { text: "Android SDK Platform-Tools", install: "android" } },
    { key: "emulator", platform: "android", label: "Android emulator", ok: false, detail: "Not found", fix: { text: "Android Emulator", install: "android" } },
  ],
  devices: 0,
};

function setup(status: SimulatorStatus = OK) {
  api.call.mockImplementation((method, url) => {
    if (url.endsWith("/install")) return Promise.resolve({} as Partial<Record<string, InstallJob>>);
    return Promise.resolve(status);
  });
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
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });

  it("starts an install and shows the job's last line while it runs", async () => {
    let finish: ((job: InstallJob) => void) | undefined;
    api.call.mockImplementation((method, url) => {
      if (url.endsWith("/install") && method === "POST") return new Promise<InstallJob>((resolve) => (finish = resolve));
      if (url.endsWith("/install")) return Promise.resolve({});
      return Promise.resolve(OK);
    });
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Install" }))[0]!);
    expect(api.call).toHaveBeenCalledWith("POST", "/api/connectors/simulators/install", { key: "axe" });
    finish?.({ status: "running", line: "Downloading AXe 1.8.0" });
    expect(await screen.findByText("Downloading AXe 1.8.0")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(1);
  });

  it("offers Try again when an install failed", async () => {
    api.call.mockImplementation((method, url) => {
      if (url.endsWith("/install") && method === "POST") return Promise.reject(new Error("the disk is full"));
      if (url.endsWith("/install")) return Promise.resolve({});
      return Promise.resolve(OK);
    });
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Install" }))[0]!);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("the disk is full")).toBeInTheDocument();
  });

  it("shows a failure that isn't an Error as text", async () => {
    api.call.mockImplementation((method, url) => {
      if (url.endsWith("/install") && method === "POST") return Promise.reject(new Error("offline"));
      if (url.endsWith("/install")) return Promise.resolve({});
      return Promise.resolve(OK);
    });
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Install" }))[0]!);
    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says when a later row comes with the Install above", async () => {
    setup(ANDROID_ROWS);
    expect(await screen.findByText("Android SDK")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(1);
    expect(screen.getAllByText("Comes with the Install above")).toHaveLength(2);
  });

  it("looks for the tools again when an install ends", async () => {
    let job: InstallJob = { status: "running", line: "Downloading AXe" };
    let poll: (() => void) | undefined;
    api.call.mockImplementation((method, url) => {
      if (url.endsWith("/install") && method === "POST") return Promise.resolve(job);
      if (url.endsWith("/install")) return new Promise((resolve) => {
        poll = () => resolve({ axe: job });
      });
      return Promise.resolve(OK);
    });
    render(<SimulatorConnector titleClass="title" hintClass="hint" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Install" }))[0]!);
    expect((await screen.findAllByText("Downloading AXe")).length).toBeGreaterThan(0);
    const statusCalls = () => api.call.mock.calls.filter(([, url]) => url === "/api/connectors/simulators").length;
    expect(statusCalls()).toBe(1);
    job = { status: "done", line: "Installed" };
    poll?.();
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(1));
  });

  it("opens the download link outside the app", async () => {
    setup({ checks: [{ key: "studio", platform: "android", label: "Android Studio", ok: false, detail: "Missing", fix: { text: "Download Android Studio", url: "https://developer.android.com/studio" } }], devices: 0 });
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(openExternal).toHaveBeenCalledWith("https://developer.android.com/studio");
  });

  it("checks again when asked", async () => {
    setup();
    await screen.findByText("Xcode");
    const statusCalls = () => api.call.mock.calls.filter(([, url]) => url === "/api/connectors/simulators").length;
    expect(statusCalls()).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(statusCalls()).toBe(2));
  });
});

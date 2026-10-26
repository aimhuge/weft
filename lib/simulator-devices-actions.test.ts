import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

// What a thread does with a whole device (lib/simulator-devices.ts): launch an app, open a url, take a
// screenshot and read the logs, with the fake tools of lib/simulator-devices.harness.ts.
const state = await vi.hoisted(async () => (await import("./simulator-devices.harness")).simState());

vi.mock("./simulator-exec", async () => (await import("./simulator-devices.harness")).execMock(state));
vi.mock("node:child_process", async () => (await import("./simulator-devices.harness")).childMock(state));

const { replies } = await import("./simulator-devices.harness");
const devices = await import("./simulator-devices");

const IOS: Device = { id: "ABC-123", name: "iPhone 16", platform: "ios", state: "booted", runtime: "iOS 18.2" };
const ANDROID: Device = { id: "emulator-5554", name: "Pixel_7", platform: "android", state: "booted" };

beforeEach(() => {
  state.run.mockReset().mockResolvedValue(Buffer.from(""));
  state.runText.mockReset().mockResolvedValue("");
  state.spawn.mockReset();
  state.spawnEvent = "close";
  state.bins = { xcrun: "/usr/bin/xcrun", axe: null, adb: "/sdk/adb", emulator: "/sdk/emulator" };
});

describe("launch", () => {
  it("launches an app on the simulator and returns its pid line", async () => {
    replies(state, { "xcrun simctl launch": "com.example.app: 4242\n" });
    expect(await devices.launch(IOS, "com.example.app")).toBe("com.example.app: 4242");
    expect(state.runText).toHaveBeenCalledWith("xcrun", ["simctl", "launch", "ABC-123", "com.example.app"], undefined);
  });

  it("launches an app on the emulator with monkey", async () => {
    replies(state, { "adb -s emulator-5554 shell monkey": "Events injected: 1\n" });
    expect(await devices.launch(ANDROID, "com.example.app")).toBe("Events injected: 1");
    expect(state.run).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "monkey", "-p", "'com.example.app'", "-c", "android.intent.category.LAUNCHER", "1"],
      undefined,
    );
  });
});

describe("openUrl", () => {
  it("opens a url on the simulator", async () => {
    replies(state, { "xcrun simctl openurl": "" });
    await devices.openUrl(IOS, "https://example.test/page");
    expect(state.run).toHaveBeenCalledWith("xcrun", ["simctl", "openurl", "ABC-123", "https://example.test/page"], undefined);
  });

  it("reverses a local port on the emulator so the mac is reachable", async () => {
    replies(state, { adb: "" });
    await devices.openUrl(ANDROID, "http://localhost:3000/page");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "reverse", "tcp:3000", "tcp:3000"], undefined);
  });

  it("reverses the default http and https ports when the url has none", async () => {
    replies(state, { adb: "" });
    await devices.openUrl(ANDROID, "http://localhost/page");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "reverse", "tcp:80", "tcp:80"], undefined);
    await devices.openUrl(ANDROID, "https://127.0.0.1/page");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "reverse", "tcp:443", "tcp:443"], undefined);
  });

  it("does not reverse a url that points somewhere else", async () => {
    replies(state, { adb: "" });
    await devices.openUrl(ANDROID, "https://example.test/page");
    expect(state.run).not.toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "reverse", "tcp:443", "tcp:443"], undefined);
    expect(state.run).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'https://example.test/page'"],
      undefined,
    );
  });

  it("opens a string that is not a url without reversing anything", async () => {
    replies(state, { adb: "" });
    await devices.openUrl(ANDROID, "not a url");
    expect(state.run).not.toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "reverse", "tcp:80", "tcp:80"], undefined);
    expect(state.run).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'not a url'"],
      undefined,
    );
  });
});

describe("screenshot", () => {
  it("takes the android screen straight from adb", async () => {
    replies(state, { adb: "PNG" });
    expect((await devices.screenshot(ANDROID)).toString()).toBe("PNG");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "exec-out", "screencap", "-p"], undefined);
  });

  it("takes the simulator screen into a temp file and reads it back", async () => {
    state.run.mockImplementation((_name, args) => {
      fs.writeFileSync(String(args.at(-1)), "PNG");
      return Promise.resolve(Buffer.from(""));
    });
    expect((await devices.screenshot(IOS)).toString()).toBe("PNG");
    expect(state.run).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "io", "ABC-123", "screenshot", "--type=png", expect.stringContaining("weft-sim-ABC-123-")],
      undefined,
    );
  });

  it("leaves no temp file behind when the screenshot fails", async () => {
    const seen: string[] = [];
    state.run.mockImplementation((_name, args) => {
      seen.push(String(args.at(-1)));
      return Promise.reject(new Error("no screen"));
    });
    await expect(devices.screenshot(IOS)).rejects.toThrow(/no screen/);
    expect(seen).toHaveLength(1);
    expect(fs.existsSync(String(seen[0]))).toBe(false);
  });
});

describe("logs", () => {
  it("reads the newest simulator lines, with a predicate when an app is named", async () => {
    replies(state, { "xcrun simctl spawn": "line1\nline2\n" });
    expect(await devices.logs(IOS)).toBe("line1\nline2");
    expect(state.runText).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "spawn", "ABC-123", "log", "show", "--last", "2m", "--style", "compact"],
      undefined,
    );
    await devices.logs(IOS, { app: "com.example.app" });
    expect(state.runText).toHaveBeenCalledWith(
      "xcrun",
      [
        "simctl",
        "spawn",
        "ABC-123",
        "log",
        "show",
        "--last",
        "2m",
        "--style",
        "compact",
        "--predicate",
        'process == "com.example.app" OR subsystem BEGINSWITH "com.example.app"',
      ],
      undefined,
    );
  });

  it("keeps only the newest lines", async () => {
    replies(state, { "xcrun simctl spawn": "a\nb\nc\n" });
    expect(await devices.logs(IOS)).toBe("a\nb\nc");
    expect(await devices.logs(IOS, { lines: 2 })).toBe("b\nc");
    expect(await devices.logs(IOS, { lines: 0 })).toBe("c");
    expect(await devices.logs(IOS, { lines: 10_000 })).toBe("a\nb\nc");
  });

  it("reads the simulator logs of a period other than two minutes", async () => {
    replies(state, { "xcrun simctl spawn": "a\n" });
    await devices.logs(IOS, { since: "1h" });
    expect(state.runText).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "spawn", "ABC-123", "log", "show", "--last", "1h", "--style", "compact"],
      undefined,
    );
  });

  it("reads the emulator logs of one app by its pid", async () => {
    replies(state, { "adb -s emulator-5554 shell pidof": "4242\n", "adb -s emulator-5554 logcat": "log line\n" });
    expect(await devices.logs(ANDROID, { app: "com.example.app" })).toBe("log line");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "logcat", "-d", "-t", "100", "--pid=4242"], undefined);
  });

  it("says so when the app is not running", async () => {
    replies(state, { "adb -s emulator-5554 shell pidof": "" });
    await expect(devices.logs(ANDROID, { app: "com.example.app" })).rejects.toThrow(
      /com.example.app isn't running on Pixel_7; launch it first/,
    );
  });

  it("says so when pidof fails outright", async () => {
    state.run.mockImplementation((_name, args) => {
      if (args.includes("pidof")) return Promise.reject(new Error("adb died"));
      return Promise.resolve(Buffer.from(""));
    });
    await expect(devices.logs(ANDROID, { app: "com.example.app" })).rejects.toThrow(
      /com.example.app isn't running on Pixel_7; launch it first/,
    );
  });

  it("reads every emulator log when no app is named", async () => {
    replies(state, { "adb -s emulator-5554 logcat": "log line\n" });
    expect(await devices.logs(ANDROID)).toBe("log line");
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "logcat", "-d", "-t", "100"], undefined);
  });
});

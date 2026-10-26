import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

// The devices a thread can drive, listed and picked (lib/simulator-devices.ts), with the fake tools of
// lib/simulator-devices.harness.ts: no real device, no real command.
const state = await vi.hoisted(async () => (await import("./simulator-devices.harness")).simState());

vi.mock("./simulator-exec", async () => (await import("./simulator-devices.harness")).execMock(state));
vi.mock("node:child_process", async () => (await import("./simulator-devices.harness")).childMock(state));

const { replies } = await import("./simulator-devices.harness");
const devices = await import("./simulator-devices");

const IOS_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
      { udid: "ABC-123", name: "iPhone 16", state: "Booted", isAvailable: true },
      { udid: "DEF-456", name: "iPhone 16 Pro", state: "Shutdown", isAvailable: true },
      { udid: "OLD-789", name: "iPhone 12", state: "Shutdown", isAvailable: false },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [{ udid: "BOOT-1", name: "iPad", state: "Booting", isAvailable: true }],
  },
});

// The adb list "emulator-5554" is the same device as the AVD "Pixel_7"; it must not appear twice.
const ADB_LIST = "List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n";

const IOS: Device = { id: "ABC-123", name: "iPhone 16", platform: "ios", state: "booted", runtime: "iOS 18.2" };
const ANDROID: Device = { id: "emulator-5554", name: "Pixel_7", platform: "android", state: "booted" };
const AVD: Device = { id: "avd:Tablet", name: "Tablet", platform: "android", state: "shutdown" };

beforeEach(() => {
  state.run.mockReset().mockResolvedValue(Buffer.from(""));
  state.runText.mockReset().mockResolvedValue("");
  state.spawn.mockReset();
  state.spawnEvent = "close";
  state.bins = { xcrun: "/usr/bin/xcrun", axe: null, adb: "/sdk/adb", emulator: "/sdk/emulator" };
});

afterEach(() => vi.restoreAllMocks());

describe("runtimeName", () => {
  it("turns a runtime identifier into its readable name", () => {
    expect(devices.runtimeName("com.apple.CoreSimulator.SimRuntime.iOS-18-2")).toBe("iOS 18.2");
    expect(devices.runtimeName("iOS-18")).toBe("iOS 18");
    expect(devices.runtimeName("watchOS")).toBe("watchOS");
  });
});

describe("parseSimctl", () => {
  it("lists the available simulators with their runtime and state", () => {
    expect(devices.parseSimctl(IOS_JSON)).toEqual([
      { id: "ABC-123", name: "iPhone 16", platform: "ios", state: "booted", runtime: "iOS 18.2" },
      { id: "DEF-456", name: "iPhone 16 Pro", platform: "ios", state: "shutdown", runtime: "iOS 18.2" },
      { id: "BOOT-1", name: "iPad", platform: "ios", state: "booting", runtime: "iOS 17.5" },
    ]);
  });

  it("drops the unavailable simulators", () => {
    const json = JSON.stringify({ devices: { r: [{ udid: "X", name: "n", state: "Shutdown", isAvailable: false }] } });
    expect(devices.parseSimctl(json)).toEqual([]);
  });
});

describe("parseAdbDevices", () => {
  it("keeps the serials that are ready to be driven", () => {
    expect(devices.parseAdbDevices(ADB_LIST)).toEqual(["emulator-5554"]);
    expect(devices.parseAdbDevices("")).toEqual([]);
  });
});

describe("listDevices", () => {
  it("merges the simulators and the android devices", async () => {
    replies(state, {
      "xcrun simctl list": IOS_JSON,
      "adb devices": ADB_LIST,
      "adb -s emulator-5554 emu avd name": "Pixel_7\n",
      "emulator -list-avds": "Pixel_7\nTablet\n",
    });
    const list = await devices.listDevices();
    expect(list.filter((d) => d.platform === "ios")).toHaveLength(3);
    expect(list.filter((d) => d.platform === "android")).toEqual([ANDROID, AVD]);
  });

  it("lists no android devices when the sdk tools are missing", async () => {
    state.bins = { xcrun: null, axe: null, adb: null, emulator: null };
    expect(await devices.listDevices()).toEqual([]);
  });

  it("lists no simulators when xcrun fails", async () => {
    state.bins = { xcrun: "/usr/bin/xcrun", axe: null, adb: null, emulator: null };
    state.runText.mockImplementation((name) => {
      if (name === "xcrun") return Promise.reject(new Error("no xcode"));
      return Promise.resolve("");
    });
    expect(await devices.listDevices()).toEqual([]);
  });

  it("keeps the serial as the name when the avd name can't be read", async () => {
    state.runText.mockImplementation((name, args) => {
      if (name === "adb" && args[0] === "devices") return Promise.resolve("emulator-5554\tdevice\n");
      return Promise.reject(new Error("no avd name"));
    });
    const list = await devices.listDevices();
    expect(list).toEqual([{ id: "emulator-5554", name: "emulator-5554", platform: "android", state: "booted" }]);
  });

  it("keeps the serial of a real device, which has no avd", async () => {
    replies(state, { "adb devices": "R58M1234\tdevice\n", "emulator -list-avds": "" });
    const list = await devices.listDevices();
    expect(list).toEqual([{ id: "R58M1234", name: "R58M1234", platform: "android", state: "booted" }]);
  });

  it("falls back to the serial when the emulator names no avd", async () => {
    replies(state, { "adb devices": "emulator-5554\tdevice\n", "adb -s emulator-5554 emu avd name": "\n", "emulator -list-avds": "" });
    const list = await devices.listDevices();
    expect(list).toEqual([{ id: "emulator-5554", name: "emulator-5554", platform: "android", state: "booted" }]);
  });

  it("lists no android devices when adb and the emulator fail", async () => {
    state.runText.mockImplementation((name) => {
      if (name === "xcrun") return Promise.resolve(IOS_JSON);
      return Promise.reject(new Error(`${name} is broken`));
    });
    const list = await devices.listDevices();
    expect(list.filter((d) => d.platform === "android")).toEqual([]);
  });
});

describe("pickDevice", () => {
  it("picks the one booted device when none is named", () => {
    expect(devices.pickDevice([IOS, AVD])).toBe(IOS);
  });

  it("asks for a name when several devices are booted", () => {
    const other: Device = { ...IOS, id: "XYZ-9", name: "iPhone 15" };
    expect(() => devices.pickDevice([IOS, other])).toThrow(/2 devices are booted; name one: ABC-123, XYZ-9/);
  });

  it("says no device is booted when none is", () => {
    expect(() => devices.pickDevice([AVD])).toThrow(/No device is booted/);
  });

  it("finds a device by its id, name or avd name", () => {
    expect(devices.pickDevice([IOS, AVD], "abc-123")).toBe(IOS);
    expect(devices.pickDevice([IOS, AVD], "iPhone 16")).toBe(IOS);
    expect(devices.pickDevice([IOS, AVD], "tablet")).toBe(AVD);
  });

  it("prefers a booted device with that name over a shutdown one", () => {
    const shutdown: Device = { ...IOS, id: "OFF", state: "shutdown" };
    expect(devices.pickDevice([shutdown, IOS], "iphone 16")).toBe(IOS);
  });

  it("says when nothing matches the query", () => {
    expect(() => devices.pickDevice([IOS], "nope")).toThrow(/No device matches nope/);
  });
});

describe("bootedDevice", () => {
  it("returns the booted device it was asked for", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "" });
    expect(await devices.bootedDevice("ABC-123")).toMatchObject({ id: "ABC-123" });
  });

  it("refuses a device that is not booted", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "" });
    await expect(devices.bootedDevice("DEF-456")).rejects.toThrow(/iPhone 16 Pro isn't booted/);
  });
});

describe("boot", () => {
  it("does nothing for a device that is already booted", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "" });
    expect(await devices.boot("ABC-123")).toMatchObject({ state: "booted" });
    expect(state.run).not.toHaveBeenCalled();
  });

  it("boots a simulator and opens Simulator.app", async () => {
    replies(state, {
      "xcrun simctl list": IOS_JSON,
      "adb devices": "",
      "emulator -list-avds": "",
      "xcrun simctl boot": "",
      "xcrun simctl bootstatus": "",
    });
    expect(await devices.boot("DEF-456")).toMatchObject({ state: "booted" });
    expect(state.run).toHaveBeenCalledWith("xcrun", ["simctl", "boot", "DEF-456"], undefined);
    expect(state.run).toHaveBeenCalledWith("xcrun", ["simctl", "bootstatus", "DEF-456", "-b"], { timeout: devices.BOOT_MS });
    expect(state.spawn).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-a", "Simulator", "--args", "-CurrentDeviceUDID", "DEF-456"],
      { stdio: "ignore" },
    );
  });

  it("swallows the error of a simulator that booted on its own", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "" });
    state.run.mockImplementation((_name, args) => {
      if (args[1] === "boot") return Promise.reject(new Error("Unable to boot device in current state: Booted"));
      return Promise.resolve(Buffer.from(""));
    });
    await expect(devices.boot("DEF-456")).resolves.toMatchObject({ state: "booted" });
  });

  it("boots a simulator even when Simulator.app cannot be opened", async () => {
    replies(state, {
      "xcrun simctl list": IOS_JSON,
      "adb devices": "",
      "emulator -list-avds": "",
      "xcrun simctl boot": "",
      "xcrun simctl bootstatus": "",
    });
    state.spawnEvent = "error";
    await expect(devices.boot("DEF-456")).resolves.toMatchObject({ state: "booted" });
  });

  it("rethrows the error of a simulator that cannot boot", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "" });
    state.run.mockImplementation((_name, args) => {
      if (args[1] === "boot") return Promise.reject(new Error("no runtime"));
      return Promise.resolve(Buffer.from(""));
    });
    await expect(devices.boot("DEF-456")).rejects.toThrow(/no runtime/);
  });

  it("waits for an android emulator to finish booting", async () => {
    // The AVD "Tablet" is not running yet, so it is the shutdown device the boot starts; the emulator it
    // spawns turns up in adb, and its boot only completes on the second poll.
    let polls = 0;
    let spawned = false;
    state.runText.mockImplementation((name, args) => {
      if (name === "xcrun") return Promise.resolve(IOS_JSON);
      if (name === "emulator") return Promise.resolve("Tablet\n");
      if (name === "adb" && args[0] === "devices") return Promise.resolve(spawned ? "emulator-5554\tdevice\n" : "");
      if (name === "adb" && args[2] === "emu") return Promise.resolve("Tablet\n");
      return Promise.reject(new Error(`unexpected ${name} ${args.join(" ")}`));
    });
    state.run.mockImplementation((_name, args) => {
      if (args.includes("getprop")) return Promise.resolve(Buffer.from(`${polls++ ? 1 : 0}\n`));
      return Promise.resolve(Buffer.from(""));
    });
    state.spawn.mockImplementation(() => {
      spawned = true;
      return { on: () => ({ on: () => ({ unref: () => {} }) }), unref: () => {} };
    });
    let ticks = 0;
    const now = () => {
      ticks += 10_000;
      return ticks;
    };
    const device = await devices.boot("Tablet", now);
    expect(device).toMatchObject({ name: "Tablet", state: "booted" });
    expect(state.spawn).toHaveBeenCalledWith("/sdk/emulator", ["-avd", "Tablet"], { detached: true, stdio: "ignore" });
  });

  it("gives up when the emulator does not finish booting in time", async () => {
    replies(state, { "xcrun simctl list": IOS_JSON, "adb devices": "", "emulator -list-avds": "Tablet\n" });
    let ticks = 0;
    const now = () => {
      ticks += 60_000;
      return ticks;
    };
    await expect(devices.boot("Tablet", now)).rejects.toThrow(/Tablet didn't finish booting in 180s/);
  });

  it("gives up when the emulator is up but its boot check fails", async () => {
    let spawned = false;
    state.runText.mockImplementation((name, args) => {
      if (name === "xcrun") return Promise.resolve(IOS_JSON);
      if (name === "emulator") return Promise.resolve("Tablet\n");
      if (name === "adb" && args[0] === "devices") return Promise.resolve(spawned ? "emulator-5554\tdevice\n" : "");
      if (name === "adb" && args[2] === "emu") return Promise.resolve("Tablet\n");
      return Promise.reject(new Error(`unexpected ${name} ${args.join(" ")}`));
    });
    state.run.mockImplementation((_name, args) => {
      if (args.includes("getprop")) return Promise.reject(new Error("adb died"));
      return Promise.resolve(Buffer.from(""));
    });
    state.spawn.mockImplementation(() => {
      spawned = true;
      return { on: () => ({ on: () => ({ unref: () => {} }) }), unref: () => {} };
    });
    let ticks = 0;
    const now = () => {
      ticks += 60_000;
      return ticks;
    };
    await expect(devices.boot("Tablet", now)).rejects.toThrow(/Tablet didn't finish booting in 180s/);
  });
});

describe("install", () => {
  it("refuses a path that isn't a file on disk", async () => {
    await expect(devices.install(IOS, "relative/path.app")).rejects.toThrow(/No app at relative\/path.app/);
    await expect(devices.install(IOS, path.join(os.tmpdir(), "missing.app"))).rejects.toThrow(/No app at/);
  });

  it("installs an app on the simulator with simctl", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-")), "My.app");
    fs.writeFileSync(file, "");
    replies(state, { "xcrun simctl install": "" });
    await devices.install(IOS, file);
    expect(state.run).toHaveBeenCalledWith("xcrun", ["simctl", "install", "ABC-123", file], undefined);
  });

  it("installs an app on the emulator with adb", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-")), "My.apk");
    fs.writeFileSync(file, "");
    replies(state, { "adb -s emulator-5554 install": "" });
    await devices.install(ANDROID, file);
    expect(state.run).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "install", "-r", file], undefined);
  });
});

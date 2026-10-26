import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Simulators: what the simulator tools have on this Mac, and the command or link that
// fixes each missing piece. The filesystem, xcode-select, simctl, the emulator and the device list are all
// mocked, so these tests pin the status lib's own decisions: what's ok, what it says, and what fix it offers.

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;
type Bins = { xcrun: string | null; axe: string | null; adb: string | null; emulator: string | null };
type Device = { id: string; name: string; platform: "ios" | "android"; state: string };

// The world the status lib looks at: what xcode-select says, what's on disk, what the tools find.
type World = {
  developerDir: string | null;
  developerDirOut: string | null;
  exists: Set<string>;
  runtimesJson: string;
  avds: string[] | null;
  bins: Bins;
  sdk: string | null;
  devices: Device[] | null;
};

const state = vi.hoisted(
  (): World => ({
    developerDir: "/Applications/Xcode.app/Contents/Developer",
    developerDirOut: null,
    exists: new Set<string>(),
    runtimesJson: JSON.stringify({ runtimes: [] }),
    avds: [],
    bins: { xcrun: "/usr/bin/xcrun", axe: null, adb: null, emulator: null },
    sdk: null,
    devices: [],
  }),
);

vi.mock("node:fs", () => ({
  default: { existsSync: (file: string) => state.exists.has(file) },
  existsSync: (file: string) => state.exists.has(file),
}));

vi.mock("node:child_process", () => ({
  execFile: (_file: string, _args: string[], _opts: unknown, cb: ExecCb) => {
    if (state.developerDir === null) cb(new Error("xcode-select: error: unable to get active developer directory"), "", "");
    else if (state.developerDirOut !== null) cb(null, state.developerDirOut, "");
    else cb(null, `${state.developerDir}\n`, "");
  },
}));

vi.mock("./simulator-exec", () => ({
  androidSdk: () => state.sdk,
  bins: () => state.bins,
  runText: (name: string, args: string[]): Promise<string> => {
    if (name === "xcrun" && args[0] === "simctl") return Promise.resolve(state.runtimesJson);
    if (name === "emulator" && args[0] === "-list-avds") {
      if (state.avds === null) return Promise.reject(new Error("emulator: failed to list AVDs"));
      return Promise.resolve(state.avds.join("\n"));
    }
    return Promise.resolve("");
  },
}));

vi.mock("./simulator-devices", () => ({
  listDevices: (): Promise<Device[]> => {
    if (state.devices === null) return Promise.reject(new Error("listDevices blew up"));
    return Promise.resolve(state.devices);
  },
}));

const { simulatorStatus, iosRuntimes, XCODE_APP, STUDIO_APP } = await import("./simulator-status");
type Status = Awaited<ReturnType<typeof simulatorStatus>>;
type Check = Status["checks"][number];

const row = (status: Status, key: string): Check => {
  const found = status.checks.find((c) => c.key === key);
  if (!found) throw new Error(`no row named ${key}`);
  return found;
};

const allPresent = () => {
  state.exists = new Set([XCODE_APP, STUDIO_APP]);
  state.developerDir = "/Applications/Xcode.app/Contents/Developer";
  state.runtimesJson = JSON.stringify({ runtimes: [{ name: "iOS 18.2", platform: "iOS", isAvailable: true }] });
  state.avds = ["Pixel_8_API_34"];
  state.sdk = "/Users/me/Library/Android/sdk";
  state.bins = { xcrun: "/usr/bin/xcrun", axe: "/opt/homebrew/bin/axe", adb: "/Users/me/Library/Android/sdk/platform-tools/adb", emulator: "/Users/me/Library/Android/sdk/emulator/emulator" };
  state.devices = [];
};

beforeEach(() => {
  allPresent();
});

describe("simulatorStatus", () => {
  it("reports every piece ok, with no fix to offer", async () => {
    const status = await simulatorStatus();
    expect(status.checks).toHaveLength(9);
    expect(status.checks.every((c) => c.ok)).toBe(true);
    expect(status.checks.every((c) => c.fix === undefined)).toBe(true);
    expect(row(status, "xcode").detail).toBe(XCODE_APP);
    expect(row(status, "xcode-select").detail).toBe("/Applications/Xcode.app/Contents/Developer");
    expect(row(status, "runtime").detail).toBe("iOS 18.2");
    expect(row(status, "axe").detail).toBe("/opt/homebrew/bin/axe");
    expect(row(status, "studio").detail).toBe(STUDIO_APP);
    expect(row(status, "sdk").detail).toBe("/Users/me/Library/Android/sdk");
    expect(row(status, "adb").detail).toBe("/Users/me/Library/Android/sdk/platform-tools/adb");
    expect(row(status, "emulator").detail).toBe("/Users/me/Library/Android/sdk/emulator/emulator");
    expect(row(status, "avd").detail).toBe("Pixel_8_API_34");
  });

  it("counts the devices it finds", async () => {
    state.devices = [
      { id: "udid-1", name: "iPhone 16", platform: "ios", state: "booted" },
      { id: "emulator-5554", name: "Pixel_8_API_34", platform: "android", state: "shutdown" },
    ];
    expect((await simulatorStatus()).devices).toBe(2);
  });

  it("reports no devices when the device list fails", async () => {
    state.devices = null;
    expect((await simulatorStatus()).devices).toBe(0);
  });

  it("puts the iOS rows before the Android ones", async () => {
    const status = await simulatorStatus();
    expect(status.checks.map((c) => c.platform)).toEqual(["ios", "ios", "ios", "ios", "android", "android", "android", "android", "android"]);
  });
});

describe("when everything is missing", () => {
  beforeEach(() => {
    state.exists = new Set();
    state.developerDir = null;
    state.runtimesJson = JSON.stringify({ runtimes: [] });
    state.avds = null;
    state.sdk = null;
    state.bins = { xcrun: null, axe: null, adb: null, emulator: null };
  });

  it("marks every row as missing", async () => {
    const status = await simulatorStatus();
    expect(status.checks.every((c) => !c.ok)).toBe(true);
  });

  it("offers the App Store link for Xcode and the download link for Android Studio", async () => {
    const status = await simulatorStatus();
    expect(row(status, "xcode").fix).toEqual({
      text: "Install Xcode from the App Store",
      url: "https://apps.apple.com/app/xcode/id497799835",
    });
    expect(row(status, "studio").fix).toEqual({
      text: "Download Android Studio",
      url: "https://developer.android.com/studio",
    });
  });

  it("offers to install the command-line tools when no developer folder is selected", async () => {
    const status = await simulatorStatus();
    expect(row(status, "xcode-select")).toMatchObject({
      ok: false,
      detail: "No developer folder",
      fix: { text: "Point the command-line tools at Xcode", command: `sudo xcode-select -s ${XCODE_APP}/Contents/Developer`, install: "xcode-select" },
    });
  });

  it("offers to download the runtime when none is downloaded", async () => {
    const status = await simulatorStatus();
    expect(row(status, "runtime")).toMatchObject({
      ok: false,
      detail: "None downloaded",
      fix: { text: "Download one (several GB), or Xcode → Settings → Components", command: "xcodebuild -downloadPlatform iOS", install: "runtime" },
    });
  });

  it("offers to install AXe when it isn't installed", async () => {
    const status = await simulatorStatus();
    expect(row(status, "axe")).toMatchObject({
      ok: false,
      detail: "Not installed",
      fix: { text: "Into ~/.weft/tools, from its GitHub release", install: "axe" },
    });
    expect(row(status, "axe").fix?.command).toBeUndefined();
  });

  it("offers one Android install for a missing SDK, adb, emulator or virtual device", async () => {
    const status = await simulatorStatus();
    expect(row(status, "sdk")).toMatchObject({
      ok: false,
      detail: "Not found",
      fix: { text: "The SDK, adb, the emulator and a Pixel 9, several GB (accepts Google's SDK licenses)", install: "android" },
    });
    expect(row(status, "adb").fix).toMatchObject({ text: "Android SDK Platform-Tools", install: "android" });
    expect(row(status, "emulator").fix).toMatchObject({ text: "Android Emulator", install: "android" });
    expect(row(status, "avd")).toMatchObject({
      ok: false,
      detail: "None made yet",
      fix: { text: "A Pixel 9 with Android 16 and Google Play", install: "android" },
    });
  });
});

describe("the selected developer directory", () => {
  it("treats the command-line tools as no Xcode selected", async () => {
    state.developerDir = "/Library/Developer/CommandLineTools";
    const status = await simulatorStatus();
    expect(row(status, "xcode-select").ok).toBe(false);
    expect(row(status, "xcode-select").detail).toBe("/Library/Developer/CommandLineTools");
  });

  it("skips the runtimes when the command-line tools are selected", async () => {
    state.developerDir = "/Library/Developer/CommandLineTools";
    const status = await simulatorStatus();
    expect(row(status, "runtime")).toMatchObject({ ok: false, detail: "None downloaded" });
  });

  it("treats an empty developer folder as none selected", async () => {
    state.developerDirOut = "  \n";
    const status = await simulatorStatus();
    expect(row(status, "xcode-select")).toMatchObject({ ok: false, detail: "No developer folder" });
  });
});

describe("iosRuntimes", () => {
  it("keeps the available iOS runtimes", async () => {
    state.runtimesJson = JSON.stringify({
      runtimes: [
        { name: "iOS 18.2", platform: "iOS", isAvailable: true },
        { name: "iOS 17.5", platform: "iOS", isAvailable: true },
      ],
    });
    expect(await iosRuntimes()).toEqual(["iOS 18.2", "iOS 17.5"]);
  });

  it("drops a runtime that isn't available", async () => {
    state.runtimesJson = JSON.stringify({
      runtimes: [
        { name: "iOS 18.2", platform: "iOS", isAvailable: true },
        { name: "iOS 19.0", platform: "iOS", isAvailable: false },
      ],
    });
    expect(await iosRuntimes()).toEqual(["iOS 18.2"]);
  });

  it("drops a runtime that isn't iOS", async () => {
    state.runtimesJson = JSON.stringify({
      runtimes: [
        { name: "iOS 18.2", platform: "iOS" },
        { name: "watchOS 11.0", platform: "watchOS" },
      ],
    });
    expect(await iosRuntimes()).toEqual(["iOS 18.2"]);
  });

  it("falls back to the name when the runtime has no platform", async () => {
    state.runtimesJson = JSON.stringify({ runtimes: [{ name: "iOS 18.2" }] });
    expect(await iosRuntimes()).toEqual(["iOS 18.2"]);
  });

  it("returns nothing when simctl's JSON can't be parsed", async () => {
    state.runtimesJson = "not json at all";
    expect(await iosRuntimes()).toEqual([]);
  });
});

describe("the Android emulator", () => {
  it("skips the AVD list when the emulator isn't installed", async () => {
    state.bins = { ...state.bins, emulator: null };
    const status = await simulatorStatus();
    expect(row(status, "avd").detail).toBe("None made yet");
  });

  it("reports no AVDs when the emulator fails to list them", async () => {
    state.avds = null;
    const status = await simulatorStatus();
    expect(row(status, "avd")).toMatchObject({ ok: false, detail: "None made yet" });
  });

  it("skips the lines that aren't AVD names", async () => {
    state.avds = ["Pixel_8_API_34", "  ", "Warning: something happened"];
    const status = await simulatorStatus();
    expect(row(status, "avd")).toMatchObject({ ok: true, detail: "Pixel_8_API_34" });
  });
});

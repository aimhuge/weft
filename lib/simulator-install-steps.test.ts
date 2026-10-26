import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Simulators → Install: the fixes themselves — download AXe, download an iOS runtime,
// point the command-line tools at Xcode, and fill in the Android SDK. The filesystem, the helper that runs a
// program and the one that downloads a file are all mocked, so these tests pin the steps' own decisions.

const state = vi.hoisted(() => ({
  exists: new Set<string>(),
  dirs: new Set<string>(),
  files: new Map<string, string[]>(),
  removed: [] as string[],
  renamed: [] as Array<{ from: string; to: string }>,
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: (file: string) => state.exists.has(file),
    mkdtempSync: (prefix: string) => {
      const dir = path.join(prefix, "tmp");
      state.dirs.add(dir);
      return dir;
    },
    rmSync: (file: string) => {
      state.removed.push(file);
      state.dirs.delete(file);
    },
    mkdirSync: (dir: string) => {
      state.dirs.add(dir);
    },
    readdirSync: (dir: string) => state.files.get(dir) ?? [],
    renameSync: (from: string, to: string) => state.renamed.push({ from, to }),
  },
  existsSync: (file: string) => state.exists.has(file),
  mkdtempSync: (prefix: string) => {
    const dir = path.join(prefix, "tmp");
    state.dirs.add(dir);
    return dir;
  },
  rmSync: (file: string) => {
    state.removed.push(file);
    state.dirs.delete(file);
  },
  mkdirSync: (dir: string) => {
    state.dirs.add(dir);
  },
  readdirSync: (dir: string) => state.files.get(dir) ?? [],
  renameSync: (from: string, to: string) => state.renamed.push({ from, to }),
}));

const install = vi.hoisted(() => ({
  runStep: vi.fn<(file: string, args: string[], opts: { onLine: (line: string) => void; env?: NodeJS.ProcessEnv; input?: string }) => Promise<void>>(),
  download: vi.fn<(url: string, file: string, sha256: string) => Promise<void>>(),
}));
vi.mock("./simulator-install", () => ({
  download: install.download,
  runStep: install.runStep,
}));

const exec = vi.hoisted(() => ({ androidSdk: vi.fn(), TOOLS_DIR: "/Users/me/.weft/tools" }));
vi.mock("./simulator-exec", () => ({
  androidSdk: exec.androidSdk,
  TOOLS_DIR: exec.TOOLS_DIR,
}));

const { ANDROID_API, ANDROID_IMAGE, AVD_NAME, INSTALLERS, STUDIO_APP, XCODE_APP } = await import("./simulator-install-steps");

const javaHome = path.join(STUDIO_APP, "Contents", "jbr", "Contents", "Home");
const sdk = "/Users/me/Library/Android/sdk";
const sdkBin = path.join(sdk, "cmdline-tools", "latest", "bin");

beforeEach(() => {
  vi.clearAllMocks();
  state.exists = new Set();
  state.dirs = new Set();
  state.files = new Map();
  state.removed = [];
  state.renamed = [];
  install.runStep.mockResolvedValue(undefined);
  install.download.mockResolvedValue(undefined);
  exec.androidSdk.mockReturnValue(null);
});

describe("the AXe installer", () => {
  it("downloads AXe, unpacks it and signs its frameworks", async () => {
    const lines: string[] = [];
    const dir = path.join(exec.TOOLS_DIR, "axe");
    state.files.set(path.join(dir, "Frameworks"), ["AXe.framework", "README.txt"]);
    await INSTALLERS.axe((line) => lines.push(line));
    expect(lines).toEqual(["Downloading AXe 1.8.0", "Signing AXe"]);
    expect(install.download).toHaveBeenCalledWith(expect.stringContaining("AXe-macOS-homebrew-v1.8.0.tar.gz"), expect.stringContaining("axe.tar.gz"), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(install.runStep).toHaveBeenNthCalledWith(1, "/usr/bin/tar", ["-xzf", expect.stringContaining("axe.tar.gz"), "-C", dir], { onLine: expect.any(Function) as (line: string) => void });
    expect(install.runStep).toHaveBeenNthCalledWith(2, "/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", path.join(dir, "Frameworks", "AXe.framework"), path.join(dir, "axe")], { onLine: expect.any(Function) as (line: string) => void });
    expect(state.removed).toContain(dir);
  });

  it("cleans up its scratch folder when a step fails", async () => {
    install.runStep.mockRejectedValueOnce(new Error("tar failed"));
    await expect(INSTALLERS.axe(() => {})).rejects.toThrow("tar failed");
    expect(state.removed.some((dir) => dir.includes("weft-axe-"))).toBe(true);
  });
});

describe("the iOS runtime installer", () => {
  it("asks xcodebuild to download iOS", async () => {
    await INSTALLERS.runtime(() => {});
    expect(install.runStep).toHaveBeenCalledWith("/usr/bin/xcodebuild", ["-downloadPlatform", "iOS"], { onLine: expect.any(Function) as (line: string) => void });
  });
});

describe("the xcode-select installer", () => {
  it("asks macOS for the password and points the tools at Xcode", async () => {
    const lines: string[] = [];
    await INSTALLERS["xcode-select"]((line) => lines.push(line));
    expect(lines).toEqual(["Asking for your password"]);
    expect(install.runStep).toHaveBeenCalledWith("/usr/bin/osascript", ["-e", `do shell script "/usr/bin/xcode-select -s ${XCODE_APP}/Contents/Developer" with administrator privileges`], { onLine: expect.any(Function) as (line: string) => void });
  });
});

describe("the Android installer", () => {
  it("says Android Studio has to be installed first", async () => {
    await expect(INSTALLERS.android(() => {})).rejects.toThrow("Install Android Studio first");
    expect(install.runStep).not.toHaveBeenCalled();
  });

  it("downloads the command-line tools when the SDK has none", async () => {
    state.exists.add(javaHome);
    const lines: string[] = [];
    await INSTALLERS.android((line) => lines.push(line));
    expect(lines).toContain("Downloading the Android command-line tools");
    expect(install.download).toHaveBeenCalledWith(expect.stringContaining("commandlinetools-mac-13114758_latest.zip"), expect.stringContaining("tools.zip"), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(install.runStep).toHaveBeenCalledWith("/usr/bin/ditto", ["-x", "-k", expect.stringContaining("tools.zip"), expect.stringContaining("weft-android-")], { onLine: expect.any(Function) as (line: string) => void });
    expect(state.renamed.some((move) => move.from.includes("cmdline-tools") && move.to.includes(path.join("Library", "Android", "sdk", "cmdline-tools", "latest")))).toBe(true);
    expect(state.removed.some((dir) => dir.includes(path.join("Library", "Android", "sdk", "cmdline-tools", "latest")))).toBe(true);
  });

  it("uses the SDK it finds and accepts the licenses", async () => {
    state.exists.add(javaHome);
    state.exists.add(path.join(sdkBin, "sdkmanager"));
    exec.androidSdk.mockReturnValue(sdk);
    const lines: string[] = [];
    await INSTALLERS.android((line) => lines.push(line));
    expect(lines).toContain("Accepting the Android SDK licenses");
    expect(install.runStep).toHaveBeenCalledWith(path.join(sdkBin, "sdkmanager"), ["--licenses"], { env: { JAVA_HOME: javaHome, ANDROID_HOME: sdk }, onLine: expect.any(Function) as (line: string) => void, input: "y\n".repeat(40) });
    expect(install.runStep).toHaveBeenCalledWith(path.join(sdkBin, "sdkmanager"), ["platform-tools", "emulator", `platforms;${ANDROID_API}`, ANDROID_IMAGE], { env: { JAVA_HOME: javaHome, ANDROID_HOME: sdk }, onLine: expect.any(Function) as (line: string) => void });
  });

  it("makes a Pixel 9 when there isn't one already", async () => {
    state.exists.add(javaHome);
    state.exists.add(path.join(sdkBin, "sdkmanager"));
    exec.androidSdk.mockReturnValue(sdk);
    const lines: string[] = [];
    await INSTALLERS.android((line) => lines.push(line));
    expect(lines).toContain(`Making the ${AVD_NAME} virtual device`);
    expect(install.runStep).toHaveBeenCalledWith(path.join(sdkBin, "avdmanager"), ["create", "avd", "-n", AVD_NAME, "-k", ANDROID_IMAGE, "-d", "pixel_9"], { env: { JAVA_HOME: javaHome, ANDROID_HOME: sdk }, onLine: expect.any(Function) as (line: string) => void, input: "no\n" });
  });

  it("leaves an existing virtual device alone", async () => {
    state.exists.add(javaHome);
    state.exists.add(path.join(sdkBin, "sdkmanager"));
    state.exists.add(path.join(path.join(os.homedir(), ".android", "avd"), `${AVD_NAME}.ini`));
    exec.androidSdk.mockReturnValue(sdk);
    await INSTALLERS.android(() => {});
    expect(install.runStep.mock.calls.some((call) => call[1][0] === "create")).toBe(false);
  });
});

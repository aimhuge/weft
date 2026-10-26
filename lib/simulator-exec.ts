// The command-line tools behind the simulator tools (lib/simulator-tools.ts), found and run here: xcrun simctl
// (ships with Xcode), AXe for iOS taps and the UI tree (one Homebrew binary), and the Android SDK's adb and
// emulator. They run from Weft's server as plain programs, no shell, so nothing a thread passes is parsed twice.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Long enough for a cold boot or an install; screenshots and taps come back in well under a second.
export const RUN_MS = 120_000;
// A screenshot of a big iPad or a long log is a few MB.
const MAX_BUFFER = 64 * 1024 * 1024;

// Where Android Studio puts the SDK unless ANDROID_HOME (or the older ANDROID_SDK_ROOT) says otherwise.
export function androidSdk(env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library", "Android", "sdk")];
  return dirs.find((dir): dir is string => Boolean(dir && fs.existsSync(dir))) ?? null;
}

// The first of the candidates that exists, then the first on PATH. Weft started from the Dock gets a short PATH,
// so the usual Homebrew and SDK folders are looked at by name too.
export function findBin(name: string, candidates: string[] = [], env: NodeJS.ProcessEnv = process.env): string | null {
  const onPath = (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name));
  return [...candidates, ...onPath].find((file) => fs.existsSync(file)) ?? null;
}

const HOMEBREW = ["/opt/homebrew/bin", "/usr/local/bin"];

export function bins() {
  const sdk = androidSdk();
  return {
    xcrun: findBin("xcrun", ["/usr/bin/xcrun"]),
    axe: findBin("axe", HOMEBREW.map((dir) => path.join(dir, "axe"))),
    adb: findBin("adb", sdk ? [path.join(sdk, "platform-tools", "adb")] : []),
    emulator: findBin("emulator", sdk ? [path.join(sdk, "emulator", "emulator")] : []),
  };
}

export type Bin = keyof ReturnType<typeof bins>;

// What to tell a thread when a tool isn't there; Settings → Connectors → Simulators shows the same fixes.
export const MISSING: Record<Bin, string> = {
  xcrun: "Xcode's command-line tools aren't installed. Install Xcode from the App Store, then run `sudo xcode-select -s /Applications/Xcode.app`.",
  axe: "Tapping, typing and the UI tree on iOS need AXe, which isn't installed. Ask the user before running `brew install cameroncooke/axe/axe`.",
  adb: "The Android SDK's adb isn't installed. In Android Studio: Settings → Languages & Frameworks → Android SDK → SDK Tools → Android SDK Platform-Tools.",
  emulator: "The Android emulator isn't installed. In Android Studio: Settings → Languages & Frameworks → Android SDK → SDK Tools → Android Emulator.",
};

export function binPath(name: Bin): string {
  const file = bins()[name];
  if (!file) throw new Error(MISSING[name]);
  return file;
}

// Runs one of the tools and resolves with its stdout as bytes (a screenshot is binary). A failure rejects with
// the tool's own words, which say more than an exit code.
export function run(name: Bin, args: string[], { timeout = RUN_MS }: { timeout?: number } = {}): Promise<Buffer> {
  const file = binPath(name);
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "buffer", timeout, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (!err) {
        resolve(stdout);
        return;
      }
      const said = `${stderr.toString().trim()}\n${stdout.toString().trim()}`.trim();
      reject(new Error(said || `${name} ${args[0] ?? ""} failed: ${err.message}`));
    });
  });
}

export const runText = async (name: Bin, args: string[], opts?: { timeout?: number }) => (await run(name, args, opts)).toString("utf8");

// One argument for the device's own shell (adb shell joins its arguments and the device parses them again).
export function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

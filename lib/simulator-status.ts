// Settings → Connectors → Simulators: what's on this Mac for the simulator tools (Xcode, an iOS runtime, AXe, the
// Android SDK, adb, an emulator and an AVD), and how to fix each missing piece. It only looks: the fixes with an
// Install button run in lib/simulator-install-steps.ts when you click it.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { listDevices } from "./simulator-devices";
import { androidSdk, bins, runText } from "./simulator-exec";
import { STUDIO_APP, XCODE_APP } from "./simulator-install-steps";
import type { SimulatorCheck, SimulatorStatus } from "./simulator-view";

export { STUDIO_APP, XCODE_APP };
const XCODE_STORE = "https://apps.apple.com/app/xcode/id497799835";
const STUDIO_URL = "https://developer.android.com/studio";

function developerDir(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/xcode-select", ["-p"], { encoding: "utf8", timeout: 10_000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

type Runtime = { name: string; platform?: string; isAvailable?: boolean };

// The iOS runtimes simctl can boot ("iOS 18.2"); none when Xcode isn't selected or has none downloaded.
export async function iosRuntimes(): Promise<string[]> {
  try {
    const { runtimes } = JSON.parse(await runText("xcrun", ["simctl", "list", "runtimes", "-j"])) as { runtimes: Runtime[] };
    return runtimes.filter((r) => r.isAvailable !== false && (r.platform ?? r.name).startsWith("iOS")).map((r) => r.name);
  } catch {
    return [];
  }
}

async function avds(): Promise<string[]> {
  if (!bins().emulator) return [];
  try {
    return (await runText("emulator", ["-list-avds"])).split("\n").map((l) => l.trim()).filter((l) => l && !l.includes(" "));
  } catch {
    return [];
  }
}

// A row; the fix only goes with a piece that's missing.
const check =
  (platform: SimulatorCheck["platform"]) =>
  (key: string, label: string, ok: boolean, detail: string, fix: SimulatorCheck["fix"]): SimulatorCheck => ({ key, platform, label, ok, detail, ...(ok ? {} : { fix }) });

async function iosChecks(): Promise<SimulatorCheck[]> {
  const xcode = fs.existsSync(XCODE_APP);
  const dir = await developerDir();
  const selected = Boolean(dir && !dir.includes("CommandLineTools"));
  const runtimes = selected ? await iosRuntimes() : [];
  const axe = bins().axe;
  const ios = check("ios");
  return [
    ios("xcode", "Xcode", xcode, xcode ? XCODE_APP : "Not installed", { text: "Install Xcode from the App Store", url: XCODE_STORE }),
    ios("xcode-select", "Xcode selected", selected, dir ?? "No developer folder", { text: "Point the command-line tools at Xcode", command: `sudo xcode-select -s ${XCODE_APP}/Contents/Developer`, install: "xcode-select" }),
    ios("runtime", "iOS simulator runtime", runtimes.length > 0, runtimes.join(", ") || "None downloaded", { text: "Download one (several GB), or Xcode → Settings → Components", command: "xcodebuild -downloadPlatform iOS", install: "runtime" }),
    ios("axe", "AXe (taps, typing, UI tree)", Boolean(axe), axe ?? "Not installed", { text: "Into ~/.weft/tools, from its GitHub release", install: "axe" }),
  ];
}

async function androidChecks(): Promise<SimulatorCheck[]> {
  const studio = fs.existsSync(STUDIO_APP);
  const sdk = androidSdk();
  const { adb, emulator } = bins();
  const list = await avds();
  const android = check("android");
  // One Install fills in every missing Android piece; the panel shows it on the first missing row.
  const fill = (text: string) => ({ text, install: "android" as const });
  return [
    android("studio", "Android Studio", studio, studio ? STUDIO_APP : "Not installed", { text: "Download Android Studio", url: STUDIO_URL }),
    android("sdk", "Android SDK", Boolean(sdk), sdk ?? "Not found", fill("The SDK, adb, the emulator and a Pixel 9, several GB (accepts Google's SDK licenses)")),
    android("adb", "adb", Boolean(adb), adb ?? "Not found", fill("Android SDK Platform-Tools")),
    android("emulator", "Android emulator", Boolean(emulator), emulator ?? "Not found", fill("Android Emulator")),
    android("avd", "A virtual device", list.length > 0, list.join(", ") || "None made yet", fill("A Pixel 9 with Android 16 and Google Play")),
  ];
}

export async function simulatorStatus(): Promise<SimulatorStatus> {
  const [ios, android, devices] = await Promise.all([iosChecks(), androidChecks(), listDevices().catch(() => [])]);
  return { checks: [...ios, ...android], devices: devices.length };
}

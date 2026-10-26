// What each Install in Settings → Connectors → Simulators runs. No Homebrew, no Android Studio wizard: AXe comes
// from its GitHub release, the Android pieces from Google's command-line tools running on the Java that Android
// Studio ships with. Downloads are pinned by sha256; the one step that needs your password (xcode-select) asks
// through the macOS prompt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { download, runStep, type Installer, type OnLine } from "./simulator-install";
import { androidSdk, STUDIO_APP, TOOLS_DIR, XCODE_APP } from "./simulator-exec";
import type { InstallKey } from "./simulator-view";

export { STUDIO_APP, XCODE_APP };

// The same build Homebrew's cameroncooke/axe formula installs.
const AXE_VERSION = "1.8.0";
const AXE_URL = `https://github.com/cameroncooke/AXe/releases/download/v${AXE_VERSION}/AXe-macOS-homebrew-v${AXE_VERSION}.tar.gz`;
const AXE_SHA = "87eb09cd49dfc74fa8f7f5a46a03dfe2f14518b01d819f6a4094eab0d344ea7f";

const CLT_URL = "https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip";
const CLT_SHA = "5673201e6f3869f418eeed3b5cb6c4be7401502bd0aae1b12a29d164d647a54e";

export const ANDROID_API = "android-36";
export const ANDROID_IMAGE = `system-images;${ANDROID_API};google_apis_playstore;arm64-v8a`;
export const AVD_NAME = "Weft_Pixel_9";

// A scratch folder for one download, gone afterwards whatever happens.
async function inTemp(prefix: string, work: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    await work(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Unpacked to ~/.weft/tools/axe and signed ad hoc, as the Homebrew formula does, so macOS lets it load its frameworks.
const axe: Installer = (onLine) =>
  inTemp("weft-axe-", async (tmp) => {
    onLine(`Downloading AXe ${AXE_VERSION}`);
    const file = path.join(tmp, "axe.tar.gz");
    await download(AXE_URL, file, AXE_SHA);
    const dir = path.join(TOOLS_DIR, "axe");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await runStep("/usr/bin/tar", ["-xzf", file, "-C", dir], { onLine });
    const frameworks = fs.readdirSync(path.join(dir, "Frameworks")).filter((f) => f.endsWith(".framework"));
    onLine("Signing AXe");
    await runStep("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", ...frameworks.map((f) => path.join(dir, "Frameworks", f)), path.join(dir, "axe")], { onLine });
  });

const runtime: Installer = (onLine) => runStep("/usr/bin/xcodebuild", ["-downloadPlatform", "iOS"], { onLine });

const xcodeSelect: Installer = (onLine) => {
  onLine("Asking for your password");
  const script = `do shell script "/usr/bin/xcode-select -s ${XCODE_APP}/Contents/Developer" with administrator privileges`;
  return runStep("/usr/bin/osascript", ["-e", script], { onLine });
};

async function cmdlineTools(sdk: string, onLine: OnLine) {
  await inTemp("weft-android-", async (tmp) => {
    onLine("Downloading the Android command-line tools");
    const zip = path.join(tmp, "tools.zip");
    await download(CLT_URL, zip, CLT_SHA);
    await runStep("/usr/bin/ditto", ["-x", "-k", zip, tmp], { onLine });
    const latest = path.join(sdk, "cmdline-tools", "latest");
    fs.rmSync(latest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.renameSync(path.join(tmp, "cmdline-tools"), latest);
  });
}

// Whatever of the SDK, platform-tools (adb), the emulator, a Play system image and a Pixel 9 virtual device is
// missing. sdkmanager skips what's already there; clicking Install is your yes to Google's SDK licenses.
const android: Installer = async (onLine) => {
  const java = path.join(STUDIO_APP, "Contents", "jbr", "Contents", "Home");
  if (!fs.existsSync(java)) throw new Error("Install Android Studio first: Weft runs the Android tools on the Java it comes with.");
  const sdk = androidSdk() ?? path.join(os.homedir(), "Library", "Android", "sdk");
  const bin = path.join(sdk, "cmdline-tools", "latest", "bin");
  if (!fs.existsSync(path.join(bin, "sdkmanager"))) await cmdlineTools(sdk, onLine);
  const env = { JAVA_HOME: java, ANDROID_HOME: sdk };
  const sdkmanager = path.join(bin, "sdkmanager");
  onLine("Accepting the Android SDK licenses");
  await runStep(sdkmanager, ["--licenses"], { env, onLine, input: "y\n".repeat(40) });
  await runStep(sdkmanager, ["platform-tools", "emulator", `platforms;${ANDROID_API}`, ANDROID_IMAGE], { env, onLine });
  if (fs.existsSync(path.join(os.homedir(), ".android", "avd", `${AVD_NAME}.ini`))) return;
  onLine(`Making the ${AVD_NAME} virtual device`);
  await runStep(path.join(bin, "avdmanager"), ["create", "avd", "-n", AVD_NAME, "-k", ANDROID_IMAGE, "-d", "pixel_9"], { env, onLine, input: "no\n" });
};

export const INSTALLERS: Record<InstallKey, Installer> = { axe, runtime, "xcode-select": xcodeSelect, android };

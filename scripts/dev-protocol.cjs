#!/usr/bin/env node
// Creates ~/Applications/Weft Dev.app, a thin wrapper that declares the weft:// URL scheme in
// Info.plist and re-launches the real Electron from node_modules pointing at this project folder.
// Needed because macOS only honours a custom URL scheme if the bundle's Info.plist declares it at
// install time; the dev Electron.app (com.github.Electron) has no CFBundleURLTypes, so the OS
// silently drops weft://account-callback clicks. Re-runs on every `pnpm desktop` and is a no-op
// when the wrapper is already current.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const electronApp = path.join(projectRoot, "node_modules", "electron", "dist", "Electron.app");
const wrapperRoot = path.join(os.homedir(), "Applications", "Weft Dev.app");
const bundleId = "com.weft.dev";
const scheme = "weft";

function ensureElectron() {
  if (!fs.existsSync(electronApp)) {
    console.error(`dev-protocol: can't find ${electronApp} — run \`pnpm install\` first.`);
    process.exit(1);
  }
}

// macOS privacy (TCC) guards these folders per app. From Terminal, Electron borrows Terminal's
// permission; started by macOS (a weft:// link through the wrapper, app.relaunch()) it's judged on
// its own, can't read package.json and shows Electron's bare "Error launching app … EPERM".
const PROTECTED = ["Desktop", "Documents", "Downloads"];

function protectedFolder(root, home = os.homedir()) {
  return PROTECTED.find((name) => root === path.join(home, name) || root.startsWith(path.join(home, name) + path.sep)) ?? null;
}

const BLOCKED_TITLE = "Weft can't open its folder";
const BLOCKED_MESSAGE = (root) =>
  `macOS is blocking access to ${root}. Move the folder out of Desktop, Documents or Downloads ` +
  "(for example to ~/dev/weft) and run pnpm desktop again, or allow Weft Dev and Electron in " +
  "System Settings → Privacy & Security → Files and Folders.";

function launcherScript(root = projectRoot) {
  // Re-launches the real Electron with this project as its app folder, then forwards any
  // weft:// URL that the wrapper received as an extra argv. macOS dispatches the URL to the
  // wrapper as argv[1] when the wrapper is opened from a `weft://` link; --weft-link is the
  // explicit form the wrapper uses when it itself starts the app (so single-instance still
  // forwards the URL to the running instance via the second-instance handler).
  // It first tries to read package.json (a real open, which TCC checks; `test -r` it doesn't) and,
  // when macOS refuses, says why in a dialog instead of Electron's EPERM.
  return `#!/bin/bash
set -e
ELECTRON="${electronApp}"
PROJECT="${root}"
if ! head -c1 "$PROJECT/package.json" >/dev/null 2>&1; then
  /usr/bin/osascript -e 'on run argv' -e 'display alert (item 1 of argv) message (item 2 of argv) as critical' -e 'end run' \\
    ${JSON.stringify(BLOCKED_TITLE)} ${JSON.stringify(BLOCKED_MESSAGE(root))} >/dev/null 2>&1 || true
  exit 1
fi
exec "$ELECTRON/Contents/MacOS/Electron" "$PROJECT" --weft-link="$1"
`;
}

function warnIfProtected(root = projectRoot, log = console.warn) {
  const folder = protectedFolder(root);
  if (!folder) return false;
  log(
    `dev-protocol: this checkout is in ~/${folder}, which macOS guards per app.\n` +
      "  pnpm desktop works from Terminal, but Weft started by macOS (a weft:// link, Restart) can't read it\n" +
      `  and shows "Error launching app … EPERM". Move it, e.g. \`mv ${root} ~/dev/weft\`, then pnpm install.`,
  );
  return true;
}

function writeInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Weft Dev</string>
  <key>CFBundleDisplayName</key>
  <string>Weft Dev</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleExecutable</key>
  <string>weft-dev</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
  <key>LSUIElement</key>
  <false/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>${bundleId}</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>${scheme}</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
`;
}

function ensureWrapper() {
  const contents = path.join(wrapperRoot, "Contents");
  const macos = path.join(contents, "MacOS");
  const launcher = path.join(macos, "weft-dev");
  fs.mkdirSync(macos, { recursive: true });
  const desired = launcherScript();
  const current = fs.existsSync(launcher) ? fs.readFileSync(launcher, "utf8") : "";
  if (current !== desired) {
    fs.writeFileSync(launcher, desired, { mode: 0o755 });
    console.log("dev-protocol: wrote wrapper launcher");
  }
  const plistPath = path.join(contents, "Info.plist");
  const desiredPlist = writeInfoPlist();
  const currentPlist = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, "utf8") : "";
  if (currentPlist !== desiredPlist) {
    fs.writeFileSync(plistPath, desiredPlist);
    console.log("dev-protocol: wrote wrapper Info.plist");
  }
}

function register() {
  // Re-register with LaunchServices so a fresh Info.plist takes effect.
  const result = spawnSync("/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister", ["-f", wrapperRoot], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("dev-protocol: lsregister failed; weft:// may not dispatch to the dev build.");
  }
}

function main() {
  // Windows and Linux register weft:// from Electron main itself (electron/protocol-client.cjs).
  if (process.platform !== "darwin") return;
  ensureElectron();
  warnIfProtected();
  ensureWrapper();
  register();
  console.log(`dev-protocol: ready (${wrapperRoot} handles weft://)`);
}

if (require.main === module) main();

module.exports = { protectedFolder, launcherScript, warnIfProtected };

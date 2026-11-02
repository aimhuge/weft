// Whether a worker's Chromium can keep its sandbox (docs/architecture/worker-browser.md#the-sandbox). Chromium's
// Linux sandbox needs unprivileged user namespaces, and chrome-headless-shell ships no setuid chrome-sandbox helper to
// fall back on. Ubuntu 23.10 and later only lets a binary an AppArmor profile names make one
// (kernel.apparmor_restrict_unprivileged_userns), as it does for Google Chrome. install/worker.sh does the same for
// the pinned build: it copies it root-owned to SANDBOXED_CHROMIUM (so nothing the worker runs can swap the binary the
// profile names) and installs APPARMOR_PROFILE with sudo. Where none of that applies, the browser runs with
// --no-sandbox, a renderer exploit runs as the worker, and the gap says why: on the log and on the worker's row.
import fs from "node:fs";

export const SANDBOXED_CHROMIUM = "/opt/weft/chromium/chrome-headless-shell";
export const APPARMOR_PROFILE = "/etc/apparmor.d/weft-chromium";

export interface SandboxHost {
  platform: NodeJS.Platform;
  isRoot: boolean;
  // A file's trimmed text, or null when it can't be read.
  read(file: string): string | null;
  // A path with its links resolved, or null when it doesn't exist.
  real(file: string): string | null;
}

function readTrimmed(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function realPath(file: string): string | null {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

export function thisHost(): SandboxHost {
  return { platform: process.platform, isRoot: process.getuid?.() === 0, read: readTrimmed, real: realPath };
}

// Our profile is loaded only if the installer's apparmor_parser took it (it removes the file otherwise), and it names
// only the root-owned copy: a Chromium anywhere else, the home one included, gets no user namespace from it.
function profileCovers(bin: string, host: SandboxHost): boolean {
  if (host.real(bin) !== SANDBOXED_CHROMIUM) return false;
  const profile = host.read(APPARMOR_PROFILE);
  return Boolean(profile?.includes(` ${SANDBOXED_CHROMIUM} `) && /^\s*userns,/m.test(profile));
}

// Why this Chromium has to run with --no-sandbox here, or null when it keeps its sandbox.
export function sandboxGap(bin: string, host: SandboxHost = thisHost()): string | null {
  if (host.platform !== "linux") return null;
  if (host.isRoot) return "the worker runs as root, and Chromium won't sandbox itself as root";
  if (host.read("/proc/sys/kernel/unprivileged_userns_clone") === "0" || host.read("/proc/sys/user/max_user_namespaces") === "0") {
    return "this kernel turns off unprivileged user namespaces";
  }
  if (host.read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") === "1" && !profileCovers(bin, host)) {
    return "AppArmor blocks its user namespaces and Weft's profile isn't installed; run `weft-worker update` as a user with sudo";
  }
  return null;
}

// The line on the worker's row in Settings → Devices and Sync → Workers, or null when the browser is sandboxed.
export function sandboxNote(gap: string | null): string | null {
  return gap ? `Browser runs without sandbox: ${gap}.` : null;
}

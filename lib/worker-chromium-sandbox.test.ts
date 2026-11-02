import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { APPARMOR_PROFILE, SANDBOXED_CHROMIUM, sandboxGap, sandboxNote, thisHost, type SandboxHost } from "./worker-chromium-sandbox";

const PROFILE = `abi <abi/4.0>,
include <tunables/global>

profile weft-chromium ${SANDBOXED_CHROMIUM} flags=(unconfined) {
  userns,

  include if exists <local/weft-chromium>
}`;

// A Linux box: these files with this text, and links resolved through `links`.
function linux(files: Record<string, string>, links: Record<string, string> = {}, isRoot = false): SandboxHost {
  return { platform: "linux", isRoot, read: (f) => files[f] ?? null, real: (f) => links[f] ?? f };
}

const RESTRICTED = { "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1" };

describe("sandboxGap", () => {
  it("keeps the sandbox off Linux, and on a Linux that allows user namespaces", () => {
    expect(sandboxGap("/bin/chrome", { ...linux({}), platform: "darwin", isRoot: true })).toBeNull();
    expect(sandboxGap("/bin/chrome", linux({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "0" }))).toBeNull();
    expect(sandboxGap("/bin/chrome", linux({}))).toBeNull();
  });

  it("can't sandbox as root, or where the kernel turns user namespaces off", () => {
    expect(sandboxGap("/bin/chrome", linux({}, {}, true))).toMatch(/runs as root/);
    expect(sandboxGap("/bin/chrome", linux({ "/proc/sys/kernel/unprivileged_userns_clone": "0" }))).toMatch(/turns off unprivileged user namespaces/);
    expect(sandboxGap("/bin/chrome", linux({ "/proc/sys/user/max_user_namespaces": "0" }))).toMatch(/turns off/);
  });

  it("keeps it under AppArmor's restriction only for the root-owned copy its profile names", () => {
    const covered = { ...RESTRICTED, [APPARMOR_PROFILE]: PROFILE };
    expect(sandboxGap(SANDBOXED_CHROMIUM, linux(covered))).toBeNull();
    // Found through a link to it, it's the same binary.
    expect(sandboxGap("/usr/local/bin/chrome", linux(covered, { "/usr/local/bin/chrome": SANDBOXED_CHROMIUM }))).toBeNull();
    // The home copy, Playwright's or a system Chrome get nothing from the profile.
    expect(sandboxGap("/home/w/.weft/tools/chromium/chrome-headless-shell", linux(covered))).toMatch(/AppArmor blocks/);
    // No profile, a profile for another path, or one that doesn't allow userns.
    expect(sandboxGap(SANDBOXED_CHROMIUM, linux(RESTRICTED))).toMatch(/weft-worker update/);
    expect(sandboxGap(SANDBOXED_CHROMIUM, linux({ ...RESTRICTED, [APPARMOR_PROFILE]: PROFILE.replace(SANDBOXED_CHROMIUM, "/opt/other") }))).toMatch(/AppArmor/);
    expect(sandboxGap(SANDBOXED_CHROMIUM, linux({ ...RESTRICTED, [APPARMOR_PROFILE]: PROFILE.replace("userns,", "# userns,") }))).toMatch(/AppArmor/);
    expect(sandboxGap(SANDBOXED_CHROMIUM, linux({ ...RESTRICTED, [APPARMOR_PROFILE]: PROFILE }, { [SANDBOXED_CHROMIUM]: "" }))).toMatch(/AppArmor/);
  });
});

describe("sandboxNote", () => {
  it("is the row's warning, or nothing", () => {
    expect(sandboxNote("it runs as root")).toBe("Browser runs without sandbox: it runs as root.");
    expect(sandboxNote(null)).toBeNull();
  });
});

describe("install/worker.sh's sandbox profile", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "install/worker.sh"), "utf8");

  it("installs the copy and the profile where this module looks, naming only that copy", () => {
    expect(script).toContain(`SANDBOXED_DIR=${path.dirname(SANDBOXED_CHROMIUM)}\n`);
    expect(script).toContain(`APPARMOR_PROFILE=${APPARMOR_PROFILE}\n`);
    expect(script).toContain("profile weft-chromium $SANDBOXED_DIR/chrome-headless-shell flags=(unconfined) {\n  userns,");
    // Root-owned, so nothing the worker runs can put another binary at the path the profile names.
    expect(script).toContain('sudo chown -R root:root "$SANDBOXED_DIR.new"');
    // A profile apparmor_parser refused doesn't stay to be read as loaded.
    expect(script).toContain('[ $ok -eq 0 ] || sudo rm -f "$APPARMOR_PROFILE"');
  });
});

describe("thisHost", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sandbox-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("reads files trimmed and resolves links, with null for what isn't there", () => {
    const host = thisHost();
    expect(host.platform).toBe(process.platform);
    expect(typeof host.isRoot).toBe("boolean");
    const file = path.join(tmp, "f");
    fs.writeFileSync(file, " 1\n");
    fs.symlinkSync(file, path.join(tmp, "link"));
    expect(host.read(file)).toBe("1");
    expect(host.read(path.join(tmp, "missing"))).toBeNull();
    expect(host.real(path.join(tmp, "link"))).toBe(fs.realpathSync(file));
    expect(host.real(path.join(tmp, "missing"))).toBeNull();
    expect(sandboxGap("/bin/chrome")).toBe(process.platform === "linux" ? sandboxGap("/bin/chrome", host) : null);
  });
});

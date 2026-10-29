// The app checks its own bundle before anything needs it, so a packaged app missing a package says
// so instead of dying on a require with a native dialog (the 2026-10-28 launch crash).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRuntimeDeps, canResolve, describeMissing, packageDir, asarOf, REQUIRED } from "./runtime-deps.cjs";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-runtime-deps-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// A folder with a node_modules holding the named packages, each with a package.json.
function fakeModules(names: string[]): string {
  const modules = path.join(dir, "node_modules");
  for (const name of names) {
    const pkgDir = path.join(modules, ...name.split("/"));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }));
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};\n");
  }
  return dir;
}

describe("checkRuntimeDeps", () => {
  it("passes when every package the app needs is there", () => {
    const from = fakeModules([...REQUIRED]);
    const report = checkRuntimeDeps({ from, load: false });
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.unloadable).toEqual([]);
  });

  it("names the package that isn't there", () => {
    // The crash was exactly this: the package in package.json, but not in the shipped app.
    const from = fakeModules(REQUIRED.filter((n) => n !== "@supabase/supabase-js"));
    const report = checkRuntimeDeps({ from, load: false });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(["@supabase/supabase-js"]);
  });

  it("finds a package that is present but won't load", () => {
    const from = fakeModules(REQUIRED);
    // A package whose entry throws when it's required: present, and broken.
    const broken = path.join(from, "node_modules", "libsodium-wrappers");
    fs.writeFileSync(path.join(broken, "index.js"), "throw new Error('no native build for this platform');\n");
    const report = checkRuntimeDeps({ from, load: true });
    expect(report.ok).toBe(false);
    expect(report.unloadable.join(" ")).toContain("libsodium-wrappers");
  });

  it("checks the packages Electron main really needs", () => {
    // The one the crash was about, named so its removal is loud.
    expect(REQUIRED).toContain("@supabase/supabase-js");
    expect(REQUIRED).toContain("node-pty");
  });
});

describe("canResolve", () => {
  it("resolves a package from the folder it is in", () => {
    const from = fakeModules(["is-odd"]);
    expect(canResolve("is-odd", from)).toBe(true);
    expect(canResolve("is-even", from)).toBe(false);
  });
});

describe("asarOf", () => {
  it("finds the archive a path sits in", () => {
    expect(asarOf("/Applications/Weft.app/Contents/Resources/app.asar/electron")).toBe("/Applications/Weft.app/Contents/Resources/app.asar");
  });

  it("is null for a path that isn't in one", () => {
    expect(asarOf("/Users/someone/dev/weft/electron")).toBeNull();
    expect(asarOf("")).toBeNull();
  });
});

describe("packageDir", () => {
  it("looks inside the archive when the app runs from one", () => {
    // The bundle's own node_modules, not the machine's: the first version of this check resolved
    // the machine's copy and called a broken bundle good.
    expect(packageDir("@supabase/supabase-js", "/App/Contents/Resources/app.asar/electron")).toBe("/App/Contents/Resources/app.asar/node_modules/@supabase/supabase-js");
  });

  it("looks in the real node_modules outside an archive", () => {
    expect(packageDir("is-odd", "/dev/weft/electron")).toBe("/dev/weft/node_modules/is-odd");
  });
});

describe("describeMissing", () => {
  it("says what's missing and what to do about it", () => {
    const text = describeMissing({ missing: ["@supabase/supabase-js"], unloadable: [] });
    expect(text).toContain("@supabase/supabase-js");
    expect(text).toMatch(/Reinstall/);
  });

  it("says when a package is there but won't load", () => {
    const text = describeMissing({ missing: [], unloadable: ["node-pty (no native build)"] });
    expect(text).toContain("won't load");
    expect(text).toContain("node-pty");
  });
});

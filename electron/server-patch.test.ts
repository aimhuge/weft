import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundledDeps, patchFailed, runningPatch, serverPaths, stagePatch, stagedPatch, versionLabel } from "./server-patch.cjs";

type App = { getPath: (name: string) => string; getVersion: () => string };

let tmp: string;
let resources: string;
let app: App;

// A fake app and a fake Resources folder: the server's own code, its packages, the deps fingerprint and the skills.
function setup() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-patch-"));
  resources = path.join(tmp, "resources");
  fs.mkdirSync(path.join(resources, "server", "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(resources, "server", "server.js"), "// app server\n");
  fs.writeFileSync(path.join(resources, "server", "weft-deps.json"), JSON.stringify({ hash: "deps-hash", files: 2 }));
  fs.mkdirSync(path.join(resources, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(resources, "plugin", "skill.md"), "# skill\n");
  app = {
    getPath: () => tmp,
    getVersion: () => "0.6.7",
  };
}

const patchesDir = () => path.join(tmp, "patches");

// A stand-in for the tarball: writes the patch's files into the folder it's unpacked into.
const extract = (_tar: string, dir: string) => {
  fs.writeFileSync(path.join(dir, "server.js"), "// patched server\n");
  fs.mkdirSync(path.join(dir, "plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "skill.md"), "# patched skill\n");
};

beforeEach(() => setup());

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.resetModules();
});

describe("serverPaths and stagedPatch", () => {
  it("runs the app's own server when nothing is staged", () => {
    const paths = serverPaths(app, resources);
    expect(paths).toEqual({
      serverJs: path.join(resources, "server", "server.js"),
      pluginDir: path.join(resources, "plugin"),
      patch: null,
    });
    expect(stagedPatch(app)).toBeNull();
    expect(versionLabel(app)).toBe("0.6.7");
    expect(runningPatch()).toBeNull();
  });

  it("runs a staged patch and remembers it", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 4 }, "/tmp/patch.tar.gz", extract, resources);
    const paths = serverPaths(app, resources);
    expect(paths.patch).toBe("0.6.7+abc123");
    // The folder's name is the build with its punctuation made safe.
    expect(paths.serverJs).toBe(path.join(patchesDir(), "0.6.7-abc123", "server.js"));
    expect(paths.pluginDir).toBe(path.join(patchesDir(), "0.6.7-abc123", "plugin"));
    expect(stagedPatch(app)).toMatchObject({ build: "0.6.7+abc123", seq: 4 });
    expect(versionLabel(app)).toBe("0.6.7+abc123");
    expect(runningPatch()).toMatchObject({ build: "0.6.7+abc123", seq: 4 });
  });

  it("falls back to the app's plugin when the patch has none", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 4 }, "/tmp/patch.tar.gz", (_t, dir) => fs.writeFileSync(path.join(dir, "server.js"), "// patched\n"), resources);
    const paths = serverPaths(app, resources);
    expect(paths.pluginDir).toBe(path.join(resources, "plugin"));
  });

  it("ignores a staged patch from another app version and clears it away", () => {
    const dir = patchesDir();
    fs.mkdirSync(path.join(dir, "0.5.0+old"), { recursive: true });
    fs.writeFileSync(path.join(dir, "0.5.0+old", "server.js"), "// old\n");
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify({ build: "0.5.0+old", seq: 1, dir: "0.5.0+old" }));
    expect(stagedPatch(app)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("ignores a bad build and a patch whose server.js is missing", () => {
    const dir = patchesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify(["0.6.7+bad"]));
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify({ build: "0.6.7+bad", seq: 2, dir: "0.6.7+bad" }));
    expect(stagedPatch(app)).toBeNull();

    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify({ build: "0.6.7+gone", seq: 3, dir: "0.6.7+gone" }));
    expect(stagedPatch(app)).toBeNull();
  });

  it("ignores current.json without a build", () => {
    const dir = patchesDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify({ seq: 1 }));
    expect(stagedPatch(app)).toBeNull();
  });
});

describe("bundledDeps", () => {
  it("reads the app's package fingerprint", () => {
    expect(bundledDeps(resources)).toBe("deps-hash");
  });

  it("is null when the build has none", () => {
    expect(bundledDeps(path.join(tmp, "nothing-here"))).toBeNull();
  });
});

describe("stagePatch", () => {
  it("writes current.json and links the app's packages", () => {
    const staged = stagePatch(app, { build: "0.6.7+abc123", seq: 7 }, "/tmp/patch.tar.gz", extract, resources);
    expect(staged).toMatchObject({ build: "0.6.7+abc123", seq: 7 });
    const current = JSON.parse(fs.readFileSync(path.join(patchesDir(), "current.json"), "utf8")) as { build: string; seq: number; dir: string };
    expect(current).toEqual({ build: "0.6.7+abc123", seq: 7, dir: "0.6.7-abc123" });
    const link = path.join(patchesDir(), "0.6.7-abc123", "node_modules");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.join(resources, "server", "node_modules"));
    expect(fs.readFileSync(path.join(patchesDir(), "0.6.7-abc123", "server.js"), "utf8")).toBe("// patched server\n");
  });

  it("prunes old folders but keeps the one the server runs from", () => {
    stagePatch(app, { build: "0.6.7+first", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources); // the server now runs the first patch
    stagePatch(app, { build: "0.6.7+second", seq: 2 }, "/tmp/patch.tar.gz", extract, resources);
    const entries = fs.readdirSync(patchesDir()).sort();
    expect(entries).toContain("0.6.7-first");
    expect(entries).toContain("0.6.7-second");
    expect(entries).toContain("current.json");
  });

  it("prunes folders no server runs from", () => {
    stagePatch(app, { build: "0.6.7+first", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    fs.mkdirSync(path.join(patchesDir(), "0.6.7-stale"), { recursive: true });
    stagePatch(app, { build: "0.6.7+second", seq: 2 }, "/tmp/patch.tar.gz", extract, resources);
    expect(fs.existsSync(path.join(patchesDir(), "0.6.7-stale"))).toBe(false);
  });

  it("refuses a tarball with no server.js", () => {
    expect(() => stagePatch(app, { build: "0.6.7+bad", seq: 1 }, "/tmp/patch.tar.gz", () => {}, resources)).toThrow(
      "server patch: no server.js in the tarball",
    );
  });

  it("replaces a folder of the same name and leaves no .partial behind", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    stagePatch(app, { build: "0.6.7+abc123", seq: 2 }, "/tmp/patch.tar.gz", extract, resources);
    expect(fs.existsSync(path.join(patchesDir(), "0.6.7-abc123.partial"))).toBe(false);
    const current = JSON.parse(fs.readFileSync(path.join(patchesDir(), "current.json"), "utf8")) as { seq: number };
    expect(current.seq).toBe(2);
  });
});

describe("patchFailed", () => {
  it("drops a patch that died young onto the bad list", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources);
    const log = { write: vi.fn() };
    expect(patchFailed(app, { livedMs: 5_000, crashes: 1, maxCrashes: 3 }, log)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(patchesDir(), "bad.json"), "utf8"))).toEqual(["0.6.7+abc123"]);
    expect(fs.existsSync(path.join(patchesDir(), "current.json"))).toBe(false);
    expect(log.write).toHaveBeenCalledWith(expect.stringContaining("0.6.7+abc123"));
    // The next launch runs the app's own server.
    expect(serverPaths(app, resources)).toMatchObject({ patch: null, serverJs: path.join(resources, "server", "server.js") });
  });

  it("keeps a patch that lived long enough and isn't crashing", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources);
    expect(patchFailed(app, { livedMs: 120_000, crashes: 0, maxCrashes: 3 }, undefined)).toBe(false);
    expect(fs.existsSync(path.join(patchesDir(), "current.json"))).toBe(true);
  });

  it("drops a patch that kept crashing even after a long life", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources);
    expect(patchFailed(app, { livedMs: 120_000, crashes: 4, maxCrashes: 3 }, undefined)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(patchesDir(), "bad.json"), "utf8"))).toEqual(["0.6.7+abc123"]);
  });

  it("does nothing when the app's own server failed", () => {
    serverPaths(app, resources);
    expect(patchFailed(app, { livedMs: 1_000, crashes: 9, maxCrashes: 3 }, undefined)).toBe(false);
    expect(fs.existsSync(path.join(patchesDir(), "bad.json"))).toBe(false);
  });

  it("lists a build once, however many times it fails", () => {
    stagePatch(app, { build: "0.6.7+abc123", seq: 1 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources);
    patchFailed(app, { livedMs: 1_000, crashes: 1, maxCrashes: 3 }, undefined);
    stagePatch(app, { build: "0.6.7+abc123", seq: 2 }, "/tmp/patch.tar.gz", extract, resources);
    serverPaths(app, resources);
    patchFailed(app, { livedMs: 1_000, crashes: 1, maxCrashes: 3 }, undefined);
    expect(JSON.parse(fs.readFileSync(path.join(patchesDir(), "bad.json"), "utf8"))).toEqual(["0.6.7+abc123"]);
  });
});

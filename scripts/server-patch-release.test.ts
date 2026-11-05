import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEPS_FILE, depsFingerprint, listFiles, writeDepsFile, type DepsFingerprint } from "./server-patch-deps.mjs";
import { keyModule } from "./server-patch-keygen.mjs";
import { APP_ONLY, assetFor, blockers, detailsFor, TAG } from "./server-patch-release.mjs";

describe("blockers", () => {
  it("lets a clean tree with the version's tag ship", () => {
    expect(blockers({ version: "0.6.7", tags: ["v0.6.6", "v0.6.7"], changedSinceTag: [], dirty: [] })).toEqual([]);
  });

  it("stops a version with no tag", () => {
    expect(blockers({ version: "0.6.7", tags: ["v0.6.6"], changedSinceTag: [], dirty: [] })).toEqual([
      "no v0.6.7 tag: release the app version first, then patch it",
    ]);
  });

  it("stops a tree that changed the app itself since the tag", () => {
    const out = blockers({ version: "0.6.7", tags: ["v0.6.7"], changedSinceTag: ["electron/main.cjs"], dirty: [] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("changed since v0.6.7, which only a full release ships:");
    expect(out[0]).toContain("  electron/main.cjs");
  });

  it("stops a dirty tree", () => {
    const out = blockers({ version: "0.6.7", tags: ["v0.6.7"], changedSinceTag: [], dirty: ["lib/a.ts", "lib/b.ts"] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("uncommitted changes (commit first, or --allow-dirty to try a build):");
    expect(out[0]).toContain("  lib/a.ts");
  });

  it("lists at most ten dirty files", () => {
    const dirty = Array.from({ length: 25 }, (_, i) => `lib/f${i}.ts`);
    const out = blockers({ version: "0.6.7", tags: ["v0.6.7"], changedSinceTag: [], dirty });
    expect(out[0]).toContain("lib/f0.ts");
    expect(out[0]).not.toContain("lib/f10.ts");
  });

  it("reports every blocker at once", () => {
    expect(blockers({ version: "0.6.7", tags: [], changedSinceTag: ["electron/x.cjs"], dirty: ["lib/a.ts"] })).toHaveLength(2);
  });
});

describe("assetFor", () => {
  it("names the tarball after the build", () => {
    expect(assetFor("0.6.7+abc123")).toBe("weft-server-0.6.7-abc123.tar.gz");
  });

  it("makes a build's punctuation safe for a filename", () => {
    expect(assetFor("0.6.7+a/b c")).toBe("weft-server-0.6.7-a-b-c.tar.gz");
  });
});

describe("detailsFor", () => {
  it("builds the details a patch's feed carries", () => {
    const details = detailsFor({
      version: "0.6.7",
      commit: "abc123",
      seq: 1700000000,
      deps: "deps-hash",
      sha256: "abc",
      size: 42,
    });
    expect(details).toEqual({
      version: "0.6.7",
      build: "0.6.7+abc123",
      seq: 1700000000,
      deps: "deps-hash",
      url: "https://github.com/aimhuge/weft/releases/download/patch-latest/weft-server-0.6.7-abc123.tar.gz",
      sha256: "abc",
      size: 42,
      notes: "",
      commit: "abc123",
    });
  });

  it("keeps the notes it was given", () => {
    const details = detailsFor({ version: "0.6.7", commit: "abc123", seq: 1, deps: "d", sha256: "s", size: 1, notes: "### Fixed\n- things" });
    expect(details.notes).toBe("### Fixed\n- things");
  });

  it("publishes to the rolling patch-latest release", () => {
    expect(TAG).toBe("patch-latest");
    expect(detailsFor({ version: "0.6.7", commit: "abc123", seq: 1, deps: "d", sha256: "s", size: 1 }).url).toContain(`/releases/download/${TAG}/`);
  });
});

describe("app-only paths", () => {
  it("keeps the signed app out of a patch", () => {
    expect(APP_ONLY).toContain("electron/");
    expect(APP_ONLY).toContain("pnpm-lock.yaml");
  });
});

describe("keyModule", () => {
  it("writes the public key as a module the app can require", () => {
    const source = keyModule("BASE64KEY==");
    expect(source).toContain("module.exports = { PATCH_PUBLIC_KEY: \"BASE64KEY==\" };");
    expect(source.endsWith("\n")).toBe(true);
  });

  it("writes a null key when there is none", () => {
    expect(keyModule(null)).toContain("PATCH_PUBLIC_KEY: null");
  });
});

describe("listFiles and depsFingerprint", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-deps-"));
    fs.mkdirSync(path.join(dir, "node_modules", "react"), { recursive: true });
    fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "react", "index.js"), "module.exports = 1;");
    fs.writeFileSync(path.join(dir, "node_modules", "react", "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "node_modules", "next", "server.js"), "next\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists every file with its size, and a link with its target", () => {
    fs.symlinkSync(path.join(dir, "node_modules", "react"), path.join(dir, "node_modules", "react-link"));
    const size = (rel: string) => fs.statSync(path.join(dir, "node_modules", rel)).size;
    expect(listFiles(path.join(dir, "node_modules")).sort()).toEqual([
      `next/server.js ${size("next/server.js")}`,
      "react-link -> " + path.join(dir, "node_modules", "react"),
      `react/index.js ${size("react/index.js")}`,
      `react/package.json ${size("react/package.json")}`,
    ]);
  });

  it("is empty for a folder that isn't there", () => {
    expect(listFiles(path.join(dir, "nope"))).toEqual([]);
  });

  it("fingerprints the packages, the same way twice", () => {
    const first = depsFingerprint(dir);
    expect(first.files).toBe(3);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(depsFingerprint(dir)).toEqual(first);
  });

  it("changes when a package does", () => {
    const before = depsFingerprint(dir).hash;
    fs.writeFileSync(path.join(dir, "node_modules", "next", "server.js"), "a longer next\n");
    expect(depsFingerprint(dir).hash).not.toBe(before);
  });

  it("writes the fingerprint beside the server", () => {
    const fingerprint = writeDepsFile(dir);
    expect(fingerprint.files).toBe(3);
    const written = JSON.parse(fs.readFileSync(path.join(dir, DEPS_FILE), "utf8")) as DepsFingerprint;
    expect(written).toEqual(fingerprint);
    expect(DEPS_FILE).toBe("weft-deps.json");
  });
});

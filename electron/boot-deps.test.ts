// The boot-time dependency step: the app checks its own bundle, and installs the toolchain's trees
// after an update (electron/boot-deps.cjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBootDeps } from "./boot-deps.cjs";

let root: string;
let resources: string;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-boot-deps-"));
  resources = path.join(root, "Resources");
  dataDir = path.join(root, "data");
  fs.mkdirSync(resources, { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// The toolchain as the bundle ships it: a pnpm, an npm, and puku's tree.
function writeToolchain() {
  const toolchain = path.join(resources, "toolchain");
  fs.mkdirSync(path.join(toolchain, "pnpm", "bin"), { recursive: true });
  fs.writeFileSync(path.join(toolchain, "pnpm", "bin", "pnpm.cjs"), "// pnpm\n");
  fs.mkdirSync(path.join(toolchain, "npm", "bin"), { recursive: true });
  fs.writeFileSync(path.join(toolchain, "npm", "bin", "npm-cli.js"), "// npm\n");
  const bin = path.join(toolchain, "puku", "node_modules", "@puku", "puku-cli", "bin", "puku-cli");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "#!/usr/bin/env node\n");
  return toolchain;
}

describe("runBootDeps", () => {
  it("does nothing in dev, where the repo's node_modules is the real one", async () => {
    const result = await runBootDeps({ packaged: false, resourcesPath: resources, dataDir, version: "0.6.5" });
    expect(result.ok).toBe(true);
    expect(result.updated).toBeUndefined();
  });

  it("says the bundle is broken when a package can't be found", async () => {
    // A bundle with no packages at all: the check resolves from the bundle's own folder, the
    // way it does inside app.asar, and names what's missing.
    const bundle = path.join(root, "bundle", "electron");
    fs.mkdirSync(bundle, { recursive: true });
    const result = await runBootDeps({ packaged: true, resourcesPath: resources, dataDir, version: "0.6.5", from: bundle });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("@supabase/supabase-js");
    expect(result.error).toMatch(/Reinstall/);
  });

  it("installs the toolchain's trees when an update landed", async () => {
    writeToolchain();
    // The version changed since the last launch: an update brought this bundle.
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "updated-version"), "0.6.4\n");
    const result = await runBootDeps({ packaged: true, resourcesPath: resources, dataDir, version: "0.6.5", from: __dirname });
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(true);
  });

  it("records the version it ran, so the next launch isn't an update", async () => {
    writeToolchain();
    await runBootDeps({ packaged: true, resourcesPath: resources, dataDir, version: "0.6.5", from: __dirname });
    // The install runs in the background; the version is written when it finishes.
    await vi.waitFor(() => expect(fs.readFileSync(path.join(dataDir, "updated-version"), "utf8").trim()).toBe("0.6.5"));
  });

  it("doesn't install on an ordinary relaunch", async () => {
    writeToolchain();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "updated-version"), "0.6.5\n");
    const result = await runBootDeps({ packaged: true, resourcesPath: resources, dataDir, version: "0.6.5", from: __dirname });
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
  });
});

// The toolchain's dependency trees are installed after an update: Squirrel swaps the bundle and
// restarts the app, and the tree that ships with the bundle is installed here (electron/toolchain-install.cjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installToolchain, pnpmCommand, pukuInstalled, PUKU_BIN } from "./toolchain-install.cjs";

let root: string;
let toolchain: string;
let contents: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-toolchain-"));
  toolchain = path.join(root, "Resources", "toolchain");
  contents = path.join(root, "Resources", "..");
  // The bundled pnpm and npm, as the bundle ships them.
  fs.mkdirSync(path.join(toolchain, "pnpm", "bin"), { recursive: true });
  fs.writeFileSync(path.join(toolchain, "pnpm", "bin", "pnpm.cjs"), "// pnpm\n");
  fs.mkdirSync(path.join(toolchain, "npm", "bin"), { recursive: true });
  fs.writeFileSync(path.join(toolchain, "npm", "bin", "npm-cli.js"), "// npm\n");
  fs.mkdirSync(path.join(toolchain, "puku"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// Writes the puku tree the way a completed install leaves it.
function writePukuTree() {
  const bin = path.join(toolchain, "puku", PUKU_BIN);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "#!/usr/bin/env node\n");
  return bin;
}

// A fake pnpm: answers --version, and records the installs it was asked for.
function fakePnpm({ version = "10.33.0", fail = false } = {}) {
  const calls: { cwd: string; args: string[] }[] = [];
  const runner = vi.fn(({ cwd, args }: { cwd: string; args: string[] }) => {
    calls.push({ cwd, args });
    if (args[0] === "--version") return Promise.resolve({ ok: true, code: 0, output: `${version}\n` });
    if (fail) return Promise.resolve({ ok: false, code: 1, output: "ERR_PNPM_OUTDATED_LOCKFILE" });
    writePukuTree();
    return Promise.resolve({ ok: true, code: 0, output: "done" });
  });
  return { runner, calls };
}

describe("pukuInstalled", () => {
  it("is true once the tree's bin is there", () => {
    expect(pukuInstalled(toolchain)).toBe(false);
    writePukuTree();
    expect(pukuInstalled(toolchain)).toBe(true);
  });

  it("is false for a folder that isn't there", () => {
    expect(pukuInstalled(path.join(root, "nope"))).toBe(false);
    expect(pukuInstalled("")).toBe(false);
  });
});

describe("pnpmCommand", () => {
  it("runs the bundled pnpm", () => {
    const command = pnpmCommand({ toolchainDir: toolchain, contentsDir: contents });
    expect(command).not.toBeNull();
    expect(command?.args[0]).toBe(path.join(toolchain, "pnpm", "bin", "pnpm.cjs"));
  });

  it("is null when the bundle has no pnpm to run", () => {
    fs.rmSync(path.join(toolchain, "pnpm"), { recursive: true, force: true });
    expect(pnpmCommand({ toolchainDir: toolchain, contentsDir: contents })).toBeNull();
  });
});

describe("installToolchain", () => {
  it("installs the toolchain's dependencies after an update", async () => {
    const { runner, calls } = fakePnpm();
    const result = await installToolchain({ toolchainDir: toolchain, contentsDir: contents, runPnpm: runner });
    expect(result.needed).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.puku).toBe(true);
    // The install runs in the puku folder, with the bundled pnpm.
    const install = calls.find((c) => c.args[0] === "install");
    expect(install?.cwd).toBe(path.join(toolchain, "puku"));
    expect(result.pnpm).toBe(true);
    expect(result.npm).toBe(true);
  });

  it("leaves a complete tree alone on an ordinary launch", async () => {
    writePukuTree();
    const { runner, calls } = fakePnpm();
    const result = await installToolchain({ toolchainDir: toolchain, contentsDir: contents, runPnpm: runner });
    expect(result.needed).toBe(false);
    expect(result.installed).toBe(true);
    expect(calls.some((c) => c.args[0] === "install")).toBe(false);
  });

  it("installs anyway when it's told to", async () => {
    writePukuTree();
    const { runner, calls } = fakePnpm();
    await installToolchain({ toolchainDir: toolchain, contentsDir: contents, force: true, runPnpm: runner });
    expect(calls.some((c) => c.args[0] === "install")).toBe(true);
  });

  it("says so when pnpm itself won't run, and doesn't install", async () => {
    const runner = vi.fn(() => Promise.resolve({ ok: false, code: null, output: "", reason: "the bundled pnpm is missing" }));
    const messages: string[] = [];
    const result = await installToolchain({ toolchainDir: toolchain, contentsDir: contents, runPnpm: runner, log: (t) => messages.push(t) });
    expect(result.pnpm).toBe(false);
    expect(result.installed).toBe(false);
    expect(messages.join(" ")).toContain("pnpm");
  });

  it("reports a failed install rather than pretending it worked", async () => {
    const { runner } = fakePnpm({ fail: true });
    const messages: string[] = [];
    const result = await installToolchain({ toolchainDir: toolchain, contentsDir: contents, runPnpm: runner, log: (t) => messages.push(t) });
    expect(result.installed).toBe(false);
    expect(result.puku).toBe(false);
    expect(messages.join(" ")).toContain("failed");
  });

  it("says so when the bundle has no toolchain at all", async () => {
    const result = await installToolchain({ toolchainDir: path.join(root, "nope"), contentsDir: contents });
    expect(result.installed).toBe(false);
    expect(result.messages.join(" ")).toContain("no toolchain");
  });
});

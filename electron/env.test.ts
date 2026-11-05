import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendToolchain, fixPath } from "./env.cjs";

let dir: string;
let cacheFile: string;
const savedPath = process.env.PATH;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-env-"));
  cacheFile = path.join(dir, "shell-path");
  process.env.PATH = "/usr/bin:/bin";
});
afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

// A login shell that answers only when told to.
function slowShell(answer: string | undefined) {
  let reply = () => {};
  const done = new Promise<string | undefined>((resolve) => (reply = () => resolve(answer)));
  return { readShell: () => done, reply };
}

describe("fixPath", () => {
  it("waits for the shell on the first launch and saves its PATH", async () => {
    await fixPath({ cacheFile, readShell: () => Promise.resolve("/opt/homebrew/bin:/usr/bin") });
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(fs.readFileSync(cacheFile, "utf8")).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("uses the saved PATH at once and refreshes it in the background", async () => {
    fs.writeFileSync(cacheFile, "/old/bin\n");
    const shell = slowShell("/new/bin");
    await fixPath({ cacheFile, readShell: shell.readShell });
    expect(process.env.PATH).toBe("/old/bin:/usr/bin:/bin");
    shell.reply();
    await new Promise((r) => setTimeout(r, 0));
    expect(process.env.PATH).toBe("/new/bin:/old/bin:/usr/bin:/bin");
    expect(fs.readFileSync(cacheFile, "utf8")).toBe("/new/bin");
  });

  it("leaves PATH and the saved copy alone when the shell gives nothing", async () => {
    await fixPath({ cacheFile, readShell: () => Promise.resolve(undefined) });
    expect(process.env.PATH).toBe("/usr/bin:/bin");
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("doesn't rewrite an unchanged PATH, and survives an unwritable cache", async () => {
    fs.writeFileSync(cacheFile, "/same/bin");
    const before = fs.statSync(cacheFile).mtimeMs;
    await fixPath({ cacheFile, readShell: () => Promise.resolve("/same/bin") });
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.statSync(cacheFile).mtimeMs).toBe(before);
    const blocked = path.join(dir, "file", "shell-path");
    fs.writeFileSync(path.join(dir, "file"), "");
    await fixPath({ cacheFile: blocked, readShell: () => Promise.resolve("/x/bin") });
    expect(process.env.PATH).toMatch(/^\/x\/bin:/);
  });
});

describe("appendToolchain", () => {
  it("puts Weft's own tools after everything already on PATH", () => {
    expect(appendToolchain("/App/toolchain/bin", { exists: () => true })).toBe(true);
    expect(process.env.PATH).toBe("/usr/bin:/bin:/App/toolchain/bin");
  });

  it("moves an existing entry to the end instead of adding it twice", () => {
    process.env.PATH = "/App/toolchain/bin:/usr/bin";
    appendToolchain("/App/toolchain/bin", { exists: () => true });
    expect(process.env.PATH).toBe("/usr/bin:/App/toolchain/bin");
  });

  it("leaves PATH alone when the folder isn't there (dev, or a build without the toolchain)", () => {
    expect(appendToolchain("/App/toolchain/bin", { exists: () => false })).toBe(false);
    expect(appendToolchain("")).toBe(false);
    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("stays behind the shell's PATH when fixPath refreshes it later", async () => {
    fs.writeFileSync(cacheFile, "/old/bin\n");
    const shell = slowShell("/opt/homebrew/bin");
    await fixPath({ cacheFile, readShell: shell.readShell });
    appendToolchain("/App/toolchain/bin", { exists: () => true });
    shell.reply();
    await new Promise((r) => setTimeout(r, 0));
    expect(process.env.PATH).toBe("/opt/homebrew/bin:/old/bin:/usr/bin:/bin:/App/toolchain/bin");
  });

  it("starts PATH from nothing when it was empty", () => {
    delete process.env.PATH;
    appendToolchain("/App/toolchain/bin", { exists: () => true });
    expect(process.env.PATH).toBe("/App/toolchain/bin");
  });
});

describe("Windows", () => {
  it("leaves PATH alone: no login shell to ask, and the app already has the user's PATH", async () => {
    let asked = false;
    await fixPath({ cacheFile, platform: "win32", readShell: () => ((asked = true), Promise.resolve("/x")) });
    expect(asked).toBe(false);
    expect(process.env.PATH).toBe("/usr/bin:/bin");
  });

  it("appends the toolchain with Windows' ; separator, keeping C:\\ entries whole", () => {
    process.env.PATH = "C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\tc";
    expect(appendToolchain("C:\\tc", { exists: () => true, delimiter: ";" })).toBe(true);
    expect(process.env.PATH).toBe("C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\tc");
  });
});

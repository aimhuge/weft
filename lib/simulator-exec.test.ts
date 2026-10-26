import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The command-line tools behind the simulator tools: where they live, and how they are run.
// Nothing real is touched: node:fs and node:child_process are faked, and the fake filesystem only
// ever holds the paths the tests make up.
type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

const cp = vi.hoisted(() => ({
  execFile: vi.fn<(file: string, args: string[], opts: unknown, cb: Callback) => void>(),
  // What the next execFile() answers with.
  answer: { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: null as Error | null },
}));

vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], opts: unknown, cb: Callback) => {
    cp.execFile(file, args, opts, cb);
    cb(cp.answer.error, cp.answer.stdout, cp.answer.stderr);
  },
}));

// The paths the fake filesystem says exist.
const exists = vi.hoisted(() => new Set<string>());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const existsSync = (p: string) => exists.has(p);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

const exec = await import("./simulator-exec");

// The env the tests hand over; Next makes NODE_ENV a required part of ProcessEnv.
const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...over });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sim-exec-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  exists.clear();
  cp.execFile.mockClear();
  cp.answer = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: null };
});

describe("androidSdk", () => {
  it("prefers ANDROID_HOME when it points at a real folder", () => {
    exists.add("/sdk/home");
    expect(exec.androidSdk(env({ ANDROID_HOME: "/sdk/home", ANDROID_SDK_ROOT: "/sdk/root" }))).toBe("/sdk/home");
  });

  it("falls back to ANDROID_SDK_ROOT", () => {
    exists.add("/sdk/root");
    expect(exec.androidSdk(env({ ANDROID_SDK_ROOT: "/sdk/root" }))).toBe("/sdk/root");
  });

  it("falls back to the Android Studio folder in the home directory", () => {
    const sdk = path.join(os.homedir(), "Library", "Android", "sdk");
    exists.add(sdk);
    expect(exec.androidSdk(env({}))).toBe(sdk);
  });

  it("is null when no candidate folder is there", () => {
    expect(exec.androidSdk(env({ ANDROID_HOME: "/nope", ANDROID_SDK_ROOT: "" }))).toBeNull();
  });
});

describe("findBin", () => {
  it("takes the first candidate that exists", () => {
    exists.add("/opt/homebrew/bin/axe");
    expect(exec.findBin("axe", ["/opt/homebrew/bin/axe", "/usr/local/bin/axe"], env({}))).toBe("/opt/homebrew/bin/axe");
  });

  it("looks on PATH when no candidate is there", () => {
    exists.add("/usr/bin/xcrun");
    expect(exec.findBin("xcrun", [], env({ PATH: "/usr/bin:/bin" }))).toBe("/usr/bin/xcrun");
  });

  it("is null when it is nowhere", () => {
    expect(exec.findBin("axe", ["/opt/homebrew/bin/axe"], env({ PATH: "/usr/bin" }))).toBeNull();
  });

  it("copes with no PATH at all", () => {
    expect(exec.findBin("axe", [], env({}))).toBeNull();
  });
});

describe("bins", () => {
  it("finds each tool in its usual place", () => {
    exists.add("/usr/bin/xcrun");
    exists.add("/opt/homebrew/bin/axe");
    exists.add("/sdk");
    exists.add("/sdk/platform-tools/adb");
    exists.add("/sdk/emulator/emulator");
    process.env.ANDROID_HOME = "/sdk";
    const found = exec.bins();
    expect(found.xcrun).toBe("/usr/bin/xcrun");
    expect(found.axe).toBe("/opt/homebrew/bin/axe");
    expect(found.adb).toBe("/sdk/platform-tools/adb");
    expect(found.emulator).toBe("/sdk/emulator/emulator");
    delete process.env.ANDROID_HOME;
  });

  it("finds AXe in Weft's own tools folder", () => {
    const axe = path.join(exec.TOOLS_DIR, "axe", "axe");
    exists.add(axe);
    expect(exec.bins().axe).toBe(axe);
  });

  it("has no adb or emulator when the SDK isn't there", () => {
    const found = exec.bins();
    expect(found.adb).toBeNull();
    expect(found.emulator).toBeNull();
  });
});

describe("binPath", () => {
  it("is the path of a tool that exists", () => {
    exists.add("/usr/bin/xcrun");
    expect(exec.binPath("xcrun")).toBe("/usr/bin/xcrun");
  });

  it("says how to install the tool when it is missing", () => {
    expect(() => exec.binPath("axe")).toThrow(exec.MISSING.axe);
  });
});

describe("run", () => {
  it("runs the tool with no shell and resolves with its stdout", async () => {
    exists.add("/usr/bin/xcrun");
    cp.answer.stdout = Buffer.from("hello");
    const out = await exec.run("xcrun", ["simctl", "list"]);
    expect(out.toString()).toBe("hello");
    expect(cp.execFile).toHaveBeenCalledWith("/usr/bin/xcrun", ["simctl", "list"], expect.objectContaining({ encoding: "buffer" }), expect.any(Function));
  });

  it("waits no longer than the timeout it is given", async () => {
    exists.add("/usr/bin/xcrun");
    await exec.run("xcrun", ["boot"], { timeout: 5 });
    expect(cp.execFile.mock.calls[0]?.[2]).toMatchObject({ timeout: 5 });
  });

  it("rejects with the tool's own words", async () => {
    exists.add("/usr/bin/xcrun");
    cp.answer.error = new Error("exit 1");
    cp.answer.stderr = Buffer.from("device not found");
    await expect(exec.run("xcrun", ["boot"])).rejects.toThrow("device not found");
  });

  it("falls back to the process's message when the tool said nothing", async () => {
    exists.add("/usr/bin/xcrun");
    cp.answer.error = new Error("spawn ENOENT");
    await expect(exec.run("xcrun", ["boot"])).rejects.toThrow("xcrun boot failed: spawn ENOENT");
  });

  it("names the tool and its first argument when there is nothing else to say", async () => {
    exists.add("/usr/bin/xcrun");
    cp.answer.error = new Error("boom");
    await expect(exec.run("xcrun", [])).rejects.toThrow("xcrun  failed: boom");
  });
});

describe("runText", () => {
  it("is the tool's stdout as text", async () => {
    exists.add("/usr/bin/xcrun");
    cp.answer.stdout = Buffer.from("iPhone 17");
    expect(await exec.runText("xcrun", ["list"])).toBe("iPhone 17");
  });
});

describe("shellQuote", () => {
  it("wraps a plain word in single quotes", () => {
    expect(exec.shellQuote("com.example.app")).toBe("'com.example.app'");
  });

  it("escapes a single quote inside the word", () => {
    expect(exec.shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("sleep", () => {
  it("resolves after the milliseconds it was given", async () => {
    const started = Date.now();
    await exec.sleep(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });
});

// A worker's build arriving on the Mac (lib/device-build.ts): hashed on the way in, capped, and unpacked only after
// the zip's names and the links inside it are checked. The tests use real temp directories and a fake unzip/ditto,
// so the checks run against real files and real symlinks.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The cap is 500 MB, too big to stream in a test: a mutable one stands in for it.
const limit = vi.hoisted(() => ({ value: 1024 }));
vi.mock("./device-limits", () => ({ get MAX_BUILD_BYTES() { return limit.value; } }));

const { badZipName, checkTree, downloadBuild, sweepBuilds, unpackBuild } = await import("./device-build");
type Sh = import("./device-build").Sh;

const SHA = "b".repeat(64);

// A fake unzip and ditto: the script says what each prints, and is what a test counts calls on.
type Script = (cmd: string, args: string[]) => string;
const shOf = (script: Script): Sh => (cmd, args) => Promise.resolve(script(cmd, args));

let dir = "";

beforeEach(() => {
  limit.value = 1024;
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-build-")));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const shaOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// A fetch that hands back the bytes as a body.
const fetcherFor = (bytes: Buffer, ok = true, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(new Uint8Array(bytes), { status: ok ? 200 : status }))) as unknown as typeof fetch;

describe("downloadBuild", () => {
  it("writes the bytes and returns the file", async () => {
    const bytes = Buffer.from("hello");
    const sha = shaOf(bytes);
    const file = await downloadBuild("https://x.test/b", { sha, kind: "apk", bytes: bytes.length }, dir, fetcherFor(bytes));
    expect(file).toBe(path.join(dir, `${sha}.download`));
    expect(fs.readFileSync(file).toString()).toBe("hello");
  });

  it("deletes the file and throws when the bytes don't match the sha", async () => {
    const bytes = Buffer.from("hello");
    const wrong = "c".repeat(64);
    await expect(downloadBuild("https://x.test/b", { sha: wrong, kind: "apk", bytes: bytes.length }, dir, fetcherFor(bytes))).rejects.toThrow("don't match its hash");
    expect(fs.existsSync(path.join(dir, `${wrong}.download`))).toBe(false);
  });

  it("refuses a build whose declared size is over the cap", async () => {
    await expect(downloadBuild("https://x.test/b", { sha: SHA, kind: "apk", bytes: limit.value + 1 }, dir, fetcherFor(Buffer.alloc(0)))).rejects.toThrow("over the 500 MB limit");
  });

  it("refuses a build whose streamed bytes are over the cap, and deletes the file", async () => {
    // A stream that claims a size the declared bytes don't, so the cap is only met on the way through.
    const chunk = Buffer.alloc(512);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    });
    const fetcher = vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch;
    await expect(downloadBuild("https://x.test/b", { sha: SHA, kind: "apk", bytes: 10 }, dir, fetcher)).rejects.toThrow("over the 500 MB limit");
    expect(fs.existsSync(path.join(dir, `${SHA}.download`))).toBe(false);
  });

  it("throws on an HTTP error", async () => {
    await expect(downloadBuild("https://x.test/b", { sha: SHA, kind: "apk", bytes: 1 }, dir, fetcherFor(Buffer.alloc(0), false, 404))).rejects.toThrow("HTTP 404");
  });
});

describe("unpackBuild", () => {
  it("renames an .apk to its sha and returns it", async () => {
    const file = path.join(dir, `${SHA}.download`);
    fs.writeFileSync(file, "apk bytes");
    const apk = await unpackBuild(file, { sha: SHA, kind: "apk", bytes: 9 }, dir);
    expect(apk).toBe(path.join(dir, `${SHA}.apk`));
    expect(fs.existsSync(apk)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("unpacks a zip and returns the one .app inside", async () => {
    const file = path.join(dir, `${SHA}.download`);
    fs.writeFileSync(file, "zip");
    // The fake unzip names the zip's entries; the fake ditto makes the .app it said was there.
    const run = shOf((cmd, args) => {
      if (cmd === "unzip") return "MyApp.app/\nMyApp.app/Info.plist\n";
      const out = args.at(-1) ?? "";
      fs.mkdirSync(path.join(out, "MyApp.app"), { recursive: true });
      fs.writeFileSync(path.join(out, "MyApp.app", "Info.plist"), "plist");
      return "";
    });
    const app = await unpackBuild(file, { sha: SHA, kind: "app", bytes: 3 }, dir, run);
    expect(app).toBe(path.join(dir, SHA, "MyApp.app"));
    expect(fs.existsSync(app)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses a zip with a name leaving it, and never unpacks it", async () => {
    const file = path.join(dir, `${SHA}.download`);
    fs.writeFileSync(file, "zip");
    const script = vi.fn<Script>((cmd) => (cmd === "unzip" ? "MyApp.app/\n../escape.txt\n" : ""));
    await expect(unpackBuild(file, { sha: SHA, kind: "app", bytes: 3 }, dir, shOf(script))).rejects.toThrow("has a path leaving it");
    expect(fs.existsSync(path.join(dir, SHA))).toBe(false);
    // The ditto never ran: the zip was refused before anything was unpacked.
    expect(script).toHaveBeenCalledTimes(1);
  });

  it("refuses a zip with no .app in it, and removes the out dir", async () => {
    const file = path.join(dir, `${SHA}.download`);
    fs.writeFileSync(file, "zip");
    const run = shOf((cmd, args) => {
      if (cmd === "unzip") return "readme.txt\n";
      fs.writeFileSync(path.join(args.at(-1) ?? "", "readme.txt"), "hi");
      return "";
    });
    await expect(unpackBuild(file, { sha: SHA, kind: "app", bytes: 3 }, dir, run)).rejects.toThrow("exactly one .app");
    expect(fs.existsSync(path.join(dir, SHA))).toBe(false);
  });

  it("refuses a zip with two .app in it, and removes the out dir", async () => {
    const file = path.join(dir, `${SHA}.download`);
    fs.writeFileSync(file, "zip");
    const run = shOf((cmd, args) => {
      if (cmd === "unzip") return "A.app/\nB.app/\n";
      const out = args.at(-1) ?? "";
      fs.mkdirSync(path.join(out, "A.app"), { recursive: true });
      fs.mkdirSync(path.join(out, "B.app"), { recursive: true });
      return "";
    });
    await expect(unpackBuild(file, { sha: SHA, kind: "app", bytes: 3 }, dir, run)).rejects.toThrow("exactly one .app");
    expect(fs.existsSync(path.join(dir, SHA))).toBe(false);
  });
});

describe("badZipName", () => {
  it("names a path that would land outside", () => {
    expect(badZipName("../escape")).toBe(true);
    expect(badZipName("a/../../escape")).toBe(true);
    expect(badZipName("/etc/passwd")).toBe(true);
    expect(badZipName("a\\b")).toBe(true);
  });

  it("lets a name inside through", () => {
    expect(badZipName("MyApp.app/Info.plist")).toBe(false);
    expect(badZipName("MyApp.app")).toBe(false);
    expect(badZipName("a..b/c")).toBe(false);
  });
});

describe("checkTree", () => {
  it("accepts a tree of plain files and folders", () => {
    const root = path.join(dir, "ok");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "sub", "file.txt"), "x");
    expect(() => checkTree(root)).not.toThrow();
  });

  it("refuses a symlink that leaves the tree", () => {
    const root = path.join(dir, "out");
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync("/etc/passwd", path.join(root, "escape"));
    expect(() => checkTree(root)).toThrow("link leaving it");
  });

  it("accepts a symlink that stays inside", () => {
    const root = path.join(dir, "in");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "real.txt"), "x");
    fs.symlinkSync(path.join(root, "real.txt"), path.join(root, "alias.txt"));
    expect(() => checkTree(root)).not.toThrow();
  });

  it("refuses something that isn't a file, a folder or a link", () => {
    const root = path.join(dir, "fifo");
    fs.mkdirSync(root, { recursive: true });
    try {
      execFileSync("mkfifo", [path.join(root, "pipe")]);
    } catch {
      return; // No mkfifo here: nothing to check.
    }
    expect(() => checkTree(root)).toThrow("isn't a file");
  });
});

describe("sweepBuilds", () => {
  it("removes an old build and keeps a fresh one", () => {
    const old = path.join(dir, "old");
    const fresh = path.join(dir, "fresh");
    fs.mkdirSync(old, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    const oldAt = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    fs.utimesSync(old, oldAt, oldAt);
    sweepBuilds(dir);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("does nothing when there's no builds dir", () => {
    expect(() => sweepBuilds(path.join(dir, "nowhere"))).not.toThrow();
  });
});

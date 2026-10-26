import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Connectors → Simulators → Install: the server-side jobs behind the panel's Install buttons.
// Child processes, fetch and the filesystem are all faked, so these tests pin the install lib's own behaviour:
// the output it reports, the checks it makes on a download, and the state it keeps for each job.

type Child = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
};

const cp = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: cp.spawn }));

const files = vi.hoisted(() => ({
  written: [] as Array<{ file: string; bytes: Buffer }>,
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: (file: string, bytes: Buffer) => files.written.push({ file, bytes }),
    },
    writeFileSync: (file: string, bytes: Buffer) => files.written.push({ file, bytes }),
  };
});

const { download, installJobs, isInstallKey, runStep, startInstall } = await import("./simulator-install");

function fakeChild(): Child {
  const child = new EventEmitter() as Child;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  return child;
}

// Only what download() reads off a Response.
const fetchMock = vi.fn<(url: string) => Promise<{ ok: boolean; status: number; arrayBuffer?: () => Promise<Uint8Array> }>>();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  files.written = [];
  const global = globalThis as unknown as Record<string, unknown>;
  delete global["weft-simulator-installs"];
});

describe("runStep", () => {
  it("runs a program with no shell and reports its output lines", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const lines: string[] = [];
    const done = runStep("/usr/bin/tool", ["one"], { onLine: (line) => lines.push(line), env: { EXTRA: "yes" } });
    child.stdout.emit("data", Buffer.from("first\n"));
    child.stdout.emit("data", Buffer.from("second\n"));
    child.stderr.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0);
    await done;
    expect(cp.spawn).toHaveBeenCalledWith("/usr/bin/tool", ["one"], { env: expect.objectContaining({ EXTRA: "yes" }) as NodeJS.ProcessEnv });
    expect(lines).toStrictEqual(["first", "second", "warning"]);
    expect(child.stdin.end).toHaveBeenCalledWith(undefined);
  });

  it("treats a redrawn progress line as a new line", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const lines: string[] = [];
    const done = runStep("/usr/bin/tool", [], { onLine: (line) => lines.push(line) });
    child.stdout.emit("data", Buffer.from("10%\r"));
    child.stdout.emit("data", Buffer.from("50%\r"));
    child.stdout.emit("data", Buffer.from("100%"));
    child.emit("close", 0);
    await done;
    expect(lines).toEqual(["10%", "50%", "100%"]);
  });

  it("ignores output with nothing in it", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const lines: string[] = [];
    const done = runStep("/usr/bin/tool", [], { onLine: (line) => lines.push(line) });
    child.stdout.emit("data", Buffer.from("\n \r\n"));
    child.emit("close", 0);
    await done;
    expect(lines).toEqual([]);
  });

  it("answers the program's prompts", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const done = runStep("/usr/bin/tool", [], { onLine: () => {}, input: "y\n" });
    child.emit("close", 0);
    await done;
    expect(child.stdin.end).toHaveBeenCalledWith("y\n");
  });

  it("ignores an error writing to the program's input", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const done = runStep("/usr/bin/tool", [], { onLine: () => {} });
    expect(() => child.stdin.emit("error", new Error("closed"))).not.toThrow();
    child.emit("close", 0);
    await done;
  });

  it("rejects when the program can't be started", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const done = runStep("/usr/bin/tool", [], { onLine: () => {} });
    child.emit("error", new Error("spawn ENOENT"));
    await expect(done).rejects.toThrow("spawn ENOENT");
  });

  it("rejects with the program's last words when it fails", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const done = runStep("/usr/bin/tool", [], { onLine: () => {} });
    child.stderr.emit("data", Buffer.from("the disk is full\n"));
    child.emit("close", 1);
    await expect(done).rejects.toThrow("the disk is full");
  });

  it("names the program and its exit code when it failed without saying anything", async () => {
    const child = fakeChild();
    cp.spawn.mockReturnValue(child);
    const done = runStep("/usr/bin/tool", [], { onLine: () => {} });
    child.emit("close", 7);
    await expect(done).rejects.toThrow("tool exited with 7");
  });
});

describe("download", () => {
  it("writes the downloaded file when its checksum matches", async () => {
    const bytes = Buffer.from("AXe");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) });
    await download("https://example.test/axe.tar.gz", "/tmp/axe.tar.gz", sha256);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/axe.tar.gz");
    expect(files.written).toEqual([{ file: "/tmp/axe.tar.gz", bytes }]);
  });

  it("refuses a download the server couldn't provide", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(download("https://example.test/axe.tar.gz", "/tmp/axe.tar.gz", "abc")).rejects.toThrow("Couldn't download https://example.test/axe.tar.gz: 404");
    expect(files.written).toEqual([]);
  });

  it("refuses a file that isn't the build Weft pinned", async () => {
    const bytes = Buffer.from("something else");
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) });
    await expect(download("https://example.test/axe.tar.gz", "/tmp/axe.tar.gz", "abc")).rejects.toThrow(/axe\.tar\.gz isn't the file Weft expected \(sha256 [a-f0-9]{64}\)\./);
    expect(files.written).toEqual([]);
  });
});

describe("isInstallKey", () => {
  it("knows the keys an Install button can use", () => {
    expect(isInstallKey("axe")).toBe(true);
    expect(isInstallKey("runtime")).toBe(true);
    expect(isInstallKey("xcode-select")).toBe(true);
    expect(isInstallKey("android")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isInstallKey("xcode")).toBe(false);
    expect(isInstallKey(undefined)).toBe(false);
  });
});

describe("install jobs", () => {
  it("starts a job and follows its last line", async () => {
    let finish: (() => void) | undefined;
    const started = startInstall("axe", {
      axe: (onLine) => {
        return new Promise<void>((resolve) => {
          onLine("Downloading AXe");
          finish = resolve;
        });
      },
      runtime: () => Promise.resolve(),
      "xcode-select": () => Promise.resolve(),
      android: () => Promise.resolve(),
    });
    expect(started).toEqual({ status: "running", line: "Downloading AXe" });
    expect(installJobs().axe).toEqual({ status: "running", line: "Downloading AXe" });
    finish?.();
    await vi.waitFor(() => expect(installJobs().axe).toEqual({ status: "done", line: "Installed" }));
  });

  it("joins a job that is already running", () => {
    const installer = vi.fn(() => new Promise<void>(() => {}));
    const installers = { axe: installer, runtime: () => Promise.resolve(), "xcode-select": () => Promise.resolve(), android: () => Promise.resolve() };
    startInstall("axe", installers);
    const second = startInstall("axe", installers);
    expect(second.status).toBe("running");
    expect(installer).toHaveBeenCalledTimes(1);
  });

  it("keeps the error message when a job fails", async () => {
    const axe = vi.fn(() => Promise.reject(new Error("the disk is full")));
    const installers = { axe: () => Promise.resolve(), runtime: () => Promise.resolve(), "xcode-select": () => Promise.resolve(), android: axe };
    startInstall("android", installers);
    await vi.waitFor(() => expect(installJobs().android?.status).toBe("failed"));
    expect(installJobs().android?.line).toBe("the disk is full");
  });

  it("turns a failure that isn't an Error into text", async () => {
    const broken = { message: "broken" } as unknown as Error;
    const xcodeSelect = vi.fn(() => Promise.reject(broken));
    const installers = { axe: () => Promise.resolve(), runtime: () => Promise.resolve(), "xcode-select": xcodeSelect, android: () => Promise.resolve() };
    startInstall("xcode-select", installers);
    await vi.waitFor(() => expect(installJobs()["xcode-select"]).toEqual({ status: "failed", line: "[object Object]" }));
  });

  it("lets a finished job be started again", async () => {
    const android = vi.fn(() => Promise.resolve());
    const installers = { axe: vi.fn(() => Promise.resolve()), runtime: () => Promise.resolve(), "xcode-select": () => Promise.resolve(), android };
    startInstall("android", installers);
    await vi.waitFor(() => expect(installJobs().android?.status).toBe("done"));
    startInstall("android", installers);
    expect(android).toHaveBeenCalledTimes(2);
  });

  it("returns copies of its jobs so callers can't change them", () => {
    const installers = { axe: () => Promise.resolve(), runtime: () => Promise.resolve(), "xcode-select": () => Promise.resolve(), android: () => Promise.resolve() };
    const job = startInstall("axe", installers);
    job.line = "changed";
    expect(installJobs().axe?.line).toBe("Starting…");
  });

  it("starts with a starting line before the installer says anything", () => {
    let report: ((line: string) => void) | undefined;
    const installers = {
      axe: () => Promise.resolve(),
      runtime: (onLine: (line: string) => void) => {
        report = onLine;
        return new Promise<void>(() => {});
      },
      "xcode-select": () => Promise.resolve(),
      android: () => Promise.resolve(),
    };
    const job = startInstall("runtime", installers);
    expect(job).toEqual({ status: "running", line: "Starting…" });
    report?.("Working");
    expect(installJobs().runtime?.line).toBe("Working");
  });
});

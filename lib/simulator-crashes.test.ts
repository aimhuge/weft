// The crashes `logs` can't see (lib/simulator-crashes.ts): a report on the Mac covers every process on it, so only a
// report that names this device goes back to a worker, and only what explains the crash.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const adb = vi.hoisted(() => vi.fn());
vi.mock("./simulator-devices", () => ({ adb }));

const { crashSummary, recentCrashes } = await import("./simulator-crashes");

const IOS: Device = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };
const ANDROID: Device = { id: "emulator-5554", name: "Pixel", platform: "android", state: "booted" };

const ips = (body: unknown, header = '{"app_name":"MyApp"}') => `${header}\n${JSON.stringify(body)}`;

// A report's first line names the device it belongs to, under CoreSimulator/Devices.
const headerFor = (deviceId: string) => `{"app_name":"MyApp","path":"/Users/x/Library/Developer/CoreSimulator/Devices/${deviceId}/data"}`;

let dir = "";

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-crash-")));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A report as it lands on the Mac: the device's path in it, and the crashing thread's frames.
const report = (deviceId: string, over: Record<string, unknown> = {}) =>
  ips(
    {
      procName: "MyApp",
      exception: { type: "EXC_BAD_ACCESS", signal: "SIGSEGV" },
      termination: { indicator: "Segmentation fault" },
      faultingThread: 0,
      threads: [{ frames: [{ symbol: "main", imageIndex: 0 }, { symbol: "start", imageIndex: 1 }] }],
      usedImages: [{ name: "/path/MyApp" }, { name: "/path/libsystem" }],
      ...over,
    },
    headerFor(deviceId),
  );

describe("crashSummary", () => {
  it("ignores a report that doesn't name the device", () => {
    expect(crashSummary(report("udid-1"), "udid-2")).toBeNull();
    expect(crashSummary(report("udid-1"), "other-device")).toBeNull();
  });

  it("gives null for a report that isn't JSON", () => {
    expect(crashSummary('{"app_name":"MyApp"}\nnot json at all', "udid-1")).toBeNull();
  });

  it("formats the frames of the faulting thread", () => {
    const summary = crashSummary(report("udid-1"), "udid-1");
    expect(summary).toContain("MyApp: EXC_BAD_ACCESS SIGSEGV");
    expect(summary).toContain("Segmentation fault");
    expect(summary).toContain("0 /path/MyApp main");
    expect(summary).toContain("1 /path/libsystem start");
  });

  it("falls back to ? for a frame it can't name", () => {
    const summary = crashSummary(report("udid-1", { usedImages: [], threads: [{ frames: [{ symbol: "main" }] }] }), "udid-1");
    expect(summary).toContain("0 ? main");
  });

  it("says something even for a report with no detail", () => {
    const summary = crashSummary(ips({}, headerFor("udid-1")), "udid-1");
    expect(summary).toContain("app: crash");
  });

  it("takes the thread the report names", () => {
    const summary = crashSummary(
      report("udid-1", { faultingThread: 1, threads: [{ frames: [{ symbol: "other" }] }, { frames: [{ symbol: "crashed", imageIndex: 0 }] }] }),
      "udid-1",
    );
    expect(summary).toContain("0 /path/MyApp crashed");
    expect(summary).not.toContain("other");
  });
});

describe("recentCrashes", () => {
  const write = (name: string, body: string, at = Date.now()) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    fs.utimesSync(file, new Date(at), new Date(at));
    return file;
  };

  it("says nothing when there's no reports dir", async () => {
    expect(await recentCrashes(IOS, "MyApp", Date.now(), path.join(dir, "nowhere"))).toBe("");
  });

  it("reads the reports of the app it was asked about", async () => {
    write("MyApp-2026.ips", report("udid-1"));
    write("Other-2026.ips", report("udid-1"));
    const out = await recentCrashes(IOS, "MyApp", Date.now(), dir);
    expect(out).toContain("MyApp: EXC_BAD_ACCESS");
    expect(out).not.toContain("Other");
  });

  it("reads every report when it wasn't asked about one app", async () => {
    write("Other-2026.ips", report("udid-1", { procName: "Other" }));
    expect(await recentCrashes(IOS, undefined, Date.now(), dir)).toContain("Other: EXC_BAD_ACCESS");
  });

  it("leaves out a report older than the window", async () => {
    write("MyApp-2026.ips", report("udid-1"), Date.now() - 16 * 60_000);
    expect(await recentCrashes(IOS, "MyApp", Date.now(), dir)).toBe("");
  });

  it("reads at most three reports", async () => {
    const now = Date.now();
    write("MyApp-1.ips", report("udid-1", { procName: "One" }), now - 4_000);
    write("MyApp-2.ips", report("udid-1", { procName: "Two" }), now - 3_000);
    write("MyApp-3.ips", report("udid-1", { procName: "Three" }), now - 2_000);
    write("MyApp-4.ips", report("udid-1", { procName: "Four" }), now - 1_000);
    const out = await recentCrashes(IOS, "MyApp", now, dir);
    expect(out.split("\n\n")).toHaveLength(3);
    expect(out).toContain("Four:");
    expect(out).not.toContain("One:");
  });

  it("leaves out a report for another device", async () => {
    write("MyApp-2026.ips", report("udid-2"));
    expect(await recentCrashes(IOS, "MyApp", Date.now(), dir)).toBe("");
  });

  it("reads the android crash buffer instead", async () => {
    adb.mockResolvedValue(Buffer.from("  java.lang.FatalError: boom\n"));
    const out = await recentCrashes(ANDROID, "MyApp", Date.now(), dir);
    expect(adb).toHaveBeenCalledWith(ANDROID, ["logcat", "-d", "-b", "crash", "-t", "60"]);
    expect(out).toBe("java.lang.FatalError: boom");
  });

  it("says nothing when the android crash buffer fails", async () => {
    adb.mockRejectedValue(new Error("no adb"));
    expect(await recentCrashes(ANDROID, "MyApp", Date.now(), dir)).toBe("");
  });
});

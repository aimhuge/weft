import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { ANDROID_VIDEO, openAdbScreen, recordArgs, recordWith, ROLL_MS, rollingVideo, type Recorder } from "./adb-screen";

// screenrecord and the device's shell, faked: no device here, so these run over a fake stream (weft-worker.md says
// what a real emulator still has to show).
const IDR = Buffer.from([0, 0, 0, 1, 0x67, 0x64, 0, 0, 0, 1, 0x68, 0xee, 0, 0, 0, 1, 0x65, 0x88]);
const P = Buffer.from([0, 0, 0, 1, 0x41, 0x9a]);

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
  const lines: string[] = [];
  child.stdin.on("data", (b: Buffer) => lines.push(...b.toString().split("\n").filter(Boolean)));
  return { child, lines, asProcess: child as unknown as ChildProcess };
}

function timers() {
  const queue: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  return {
    t: { set: (fn: () => void, ms: number) => (queue.push({ fn, ms, id: ++id }), id), clear: (x: unknown) => queue.splice(0, queue.length, ...queue.filter((q) => q.id !== x)) },
    fire: () => queue.shift()?.fn(),
    queue,
  };
}

// Recordings driven by hand: each one's unit and close, and whether it was stopped.
function recorder() {
  const recs: { unit: (b: Buffer) => void; close: () => void; stop: ReturnType<typeof vi.fn> }[] = [];
  const record: Recorder = (onUnit, onClose) => {
    const stop = vi.fn();
    recs.push({ unit: onUnit, close: onClose, stop });
    return { stop };
  };
  return { recs, record };
}

describe("rollingVideo", () => {
  it("starts the next recording before the limit and switches at its first frame, with no gap", () => {
    const r = recorder();
    const tm = timers();
    const frames: string[] = [];
    const end = vi.fn();
    rollingVideo(r.record, (f) => frames.push(f.toString("hex")), end, tm.t);
    expect(tm.queue[0]?.ms).toBe(ROLL_MS);
    r.recs[0]?.unit(Buffer.from("a"));
    tm.fire();
    expect(r.recs).toHaveLength(2);
    r.recs[0]?.unit(Buffer.from("b"));
    // The new one's first frame takes over; the old one's later frames and its close are ignored.
    r.recs[1]?.unit(Buffer.from("c"));
    expect(r.recs[0]?.stop).toHaveBeenCalled();
    r.recs[0]?.unit(Buffer.from("x"));
    r.recs[0]?.close();
    r.recs[1]?.unit(Buffer.from("d"));
    expect(frames).toEqual(["61", "62", "63", "64"]);
    expect(end).not.toHaveBeenCalled();
    // The roll timer runs again for the new one, and once more only when there's no next yet.
    expect(tm.queue).toHaveLength(1);
    tm.fire();
    expect(r.recs).toHaveLength(3);
  });

  it("starts again at once when a recording that sent frames ends early, and ends when one sends none", () => {
    const r = recorder();
    const end = vi.fn();
    rollingVideo(r.record, vi.fn(), end, timers().t);
    r.recs[0]?.unit(P);
    r.recs[0]?.close();
    expect(r.recs).toHaveLength(2);
    r.recs[1]?.close();
    expect(end).toHaveBeenCalledTimes(1);
    r.recs[1]?.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("waits for the next one when the old one ends first, and ends if the next one fails with nothing running", () => {
    const r = recorder();
    const tm = timers();
    const end = vi.fn();
    const frames: Buffer[] = [];
    rollingVideo(r.record, (f) => frames.push(f), end, tm.t);
    r.recs[0]?.unit(P);
    tm.fire();
    r.recs[0]?.close();
    expect(r.recs).toHaveLength(2);
    r.recs[1]?.unit(IDR);
    expect(frames).toEqual([P, IDR]);
    tm.fire();
    // A next one that fails while the live one runs leaves it running.
    r.recs[2]?.close();
    expect(end).not.toHaveBeenCalled();
    // With no next one left, the live one's end starts another at once.
    r.recs[1]?.close();
    expect(r.recs).toHaveLength(4);
    r.recs[3]?.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("ends when the old one has stopped and the next one fails before its first frame", () => {
    const r = recorder();
    const tm = timers();
    const end = vi.fn();
    rollingVideo(r.record, vi.fn(), end, tm.t);
    r.recs[0]?.unit(P);
    tm.fire();
    r.recs[0]?.close();
    r.recs[1]?.close();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("stops both recordings, and sends nothing after", () => {
    const r = recorder();
    const tm = timers();
    const frames = vi.fn();
    const stop = rollingVideo(r.record, frames, vi.fn(), tm.t);
    tm.fire();
    stop();
    expect(r.recs[0]?.stop).toHaveBeenCalled();
    expect(r.recs[1]?.stop).toHaveBeenCalled();
    r.recs[0]?.unit(P);
    r.recs[0]?.close();
    expect(frames).not.toHaveBeenCalled();
    expect(r.recs).toHaveLength(2);
  });

  it("runs on the real clock by default", () => {
    vi.useFakeTimers();
    const r = recorder();
    rollingVideo(r.record, vi.fn(), vi.fn());
    vi.advanceTimersByTime(ROLL_MS);
    expect(r.recs).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("recordArgs", () => {
  it("asks for raw H.264 on stdout at the quality's bitrate, half size for low, under the time limit", () => {
    const size = { width: 1080, height: 2401 };
    expect(recordArgs("emulator-5554", size, "medium")).toEqual(["-s", "emulator-5554", "exec-out", "screenrecord", "--output-format=h264", `--bit-rate=${ANDROID_VIDEO.medium.bitrate}`, "--time-limit=180", "-"]);
    expect(recordArgs("e", size, "low")).toContain("--size=540x1200");
    expect(recordArgs("e", size, "high", 1_234_567.8)).toContain("--bit-rate=1234568");
  });
});

describe("recordWith", () => {
  it("cuts the process's stdout into frames, ends with it, and kills it on stop", () => {
    const f = fakeChild();
    const spawn = vi.fn(() => f.asProcess);
    const frames: Buffer[] = [];
    const closed = vi.fn();
    const rec = recordWith(spawn, "/adb", ["x"])((u) => frames.push(u), closed);
    expect(spawn).toHaveBeenCalledWith("/adb", ["x"], { stdio: ["ignore", "pipe", "ignore"] });
    f.child.stdout.emit("data", Buffer.concat([IDR, P]));
    f.child.emit("error", new Error("spawn"));
    f.child.emit("close");
    expect(frames).toEqual([IDR, P]);
    expect(closed).toHaveBeenCalled();
    rec.stop();
    expect(f.child.kill).toHaveBeenCalled();
  });
});

describe("openAdbScreen", () => {
  const open = (shell = fakeChild(), recs: ReturnType<typeof fakeChild>[] = []) => {
    const spawn = vi.fn((_bin: string, args: string[]) => {
      if (args.includes("screenrecord")) {
        const r = fakeChild();
        recs.push(r);
        return r.asProcess;
      }
      return shell.asProcess;
    });
    return { spawn, shell, recs, screen: openAdbScreen("emulator-5554", { adb: () => "/adb", spawn, sizeOf: () => Promise.resolve("Physical size: 1080x2400\n") }) };
  };

  it("is null on a box without adb", async () => {
    await expect(openAdbScreen("e", { adb: () => null })).resolves.toBeNull();
  });

  it("drives the device through one shell: a gesture, a key and a paste as input lines", async () => {
    const o = open();
    const s = await o.screen;
    expect(s?.size).toEqual({ width: 1080, height: 2400 });
    expect(o.spawn).toHaveBeenCalledWith("/adb", ["-s", "emulator-5554", "shell"], { stdio: ["pipe", "ignore", "ignore"] });
    s?.touch("down", 540, 1200);
    s?.touch("up", 540, 1200);
    s?.key(40, true);
    s?.text("hi there");
    await new Promise((r) => setImmediate(r));
    expect(o.shell.lines).toEqual(["input tap 540 1200", "input keyevent 66", "input text 'hi%sthere'"]);
    o.shell.child.emit("error", new Error("gone"));
    o.shell.child.stdin.emit("error", new Error("EPIPE"));
  });

  it("streams screenrecord's frames, ends when it refuses, and closes everything with the watch", async () => {
    const o = open();
    const s = await o.screen;
    const frames: Buffer[] = [];
    const ended = vi.fn();
    const stop = s?.video((f) => frames.push(f), ended, "low");
    expect(o.spawn.mock.calls[1]?.[1]).toContain("--size=540x1200");
    o.recs[0]?.child.stdout.emit("data", Buffer.concat([IDR, P]));
    // The P frame's NAL is whole only once the stream goes quiet (lib/h264-units.ts).
    expect(frames).toEqual([]);
    await vi.waitFor(() => expect(frames).toEqual([IDR, P]));
    stop?.();
    expect(o.recs[0]?.child.kill).toHaveBeenCalled();
    s?.video(vi.fn(), ended);
    o.recs[1]?.child.emit("close");
    expect(ended).toHaveBeenCalledTimes(1);
    s?.video(vi.fn(), vi.fn());
    s?.close();
    expect(o.recs[2]?.child.kill).toHaveBeenCalled();
    expect(o.shell.child.kill).toHaveBeenCalled();
    // A closed shell takes no more lines.
    s?.text("late");
  });
});

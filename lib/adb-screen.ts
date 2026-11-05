// An Android emulator's live screen on a worker (docs/architecture/weft-worker.md#the-fast-path): what idb is to iOS.
// Video is `adb exec-out screenrecord --output-format=h264 -`, cut into frames (lib/h264-units.ts) for the same RTP
// track and "video" channel idb feeds. screenrecord stops itself after 3 minutes, so a second one starts shortly before
// and takes over at its first frame (a key frame, with its SPS and PPS): the board sees no gap. Input goes as `input`
// lines on one `adb shell` kept open for the watch (lib/adb-input.ts). Without adb the watch stays on the JPEGs.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { gestureLines, keyLines, textLines, wmSize } from "./adb-input";
import { accessUnits } from "./h264-units";
import { DEFAULT_QUALITY, type ScreenQuality } from "./rtc-signal";
import { bins, runText } from "./simulator-exec";
import type { LiveDevice } from "./worker-fast-screen";

// screenrecord's own limit is 180 s; the next one starts at 170 s, so its first frame arrives before the old one stops.
export const TIME_LIMIT_S = 180;
export const ROLL_MS = 170_000;
// Low is half size; screenrecord takes no frame rate, so the others differ by bitrate alone.
export const ANDROID_VIDEO: Record<ScreenQuality, { half: boolean; bitrate: number }> = {
  low: { half: true, bitrate: 2_000_000 },
  medium: { half: false, bitrate: 8_000_000 },
  high: { half: false, bitrate: 20_000_000 },
};

type Spawn = (bin: string, args: string[], opts: { stdio: ("ignore" | "pipe")[] }) => ChildProcess;
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

// One screenrecord run: frames as they're cut, and onClose when it ends for any reason.
export type Recording = { stop: () => void };
export type Recorder = (onUnit: (unit: Buffer) => void, onClose: () => void) => Recording;

/**
 * Frames from one recording after another, as one stream: the next starts at `rollMs` and takes over at its first frame.
 * A recording that ends with no next one running is followed at once if it sent anything; one that sent nothing ends
 * the stream (screenrecord refused), as does a next one that fails while nothing else runs. Returns how to stop it.
 */
export function rollingVideo(record: Recorder, onFrame: (frame: Buffer) => void, onEnd: () => void, timers: Timers = realTimers, rollMs = ROLL_MS) {
  let live: Recording | null = null;
  let next: Recording | null = null;
  let roll: unknown = null;
  let over = false;
  const finish = () => {
    over = true;
    timers.clear(roll);
    onEnd();
  };
  const schedule = () => {
    timers.clear(roll);
    // Only ever set while one recording runs alone, and cleared once the stream is over.
    roll = timers.set(() => (next = open()), rollMs);
  };
  function open(): Recording {
    let sent = 0;
    const rec: Recording = record(
      (unit) => {
        if (over) return;
        if (rec === next) {
          const old = live;
          live = rec;
          next = null;
          old?.stop();
          schedule();
        }
        if (rec !== live) return;
        sent++;
        onFrame(unit);
      },
      () => {
        if (over) return;
        if (rec === next) {
          next = null;
          if (!live) finish();
        } else if (rec === live) {
          live = null;
          if (next) return;
          if (!sent) {
            finish();
            return;
          }
          live = open();
          schedule();
        }
      },
    );
    return rec;
  }
  live = open();
  schedule();
  return () => {
    over = true;
    timers.clear(roll);
    live?.stop();
    next?.stop();
  };
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** screenrecord's arguments: raw H.264 to stdout at the quality's bitrate (or the one given), half size for low. */
export function recordArgs(serial: string, size: { width: number; height: number }, quality: ScreenQuality, bitrate?: number): string[] {
  const q = ANDROID_VIDEO[quality];
  const sized = q.half ? [`--size=${even(size.width / 2)}x${even(size.height / 2)}`] : [];
  return ["-s", serial, "exec-out", "screenrecord", "--output-format=h264", `--bit-rate=${Math.round(bitrate ?? q.bitrate)}`, ...sized, `--time-limit=${TIME_LIMIT_S}`, "-"];
}

export function recordWith(spawn: Spawn, bin: string, args: string[]): Recorder {
  return (onUnit, onClose) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    const units = accessUnits(onUnit);
    child.stdout?.on("data", (chunk: Buffer) => units.push(chunk));
    child.on("error", () => {});
    child.on("close", () => {
      units.end();
      onClose();
    });
    return {
      stop: () => {
        units.stop();
        child.kill();
      },
    };
  };
}

export interface AdbDeps {
  adb: () => string | null;
  spawn: Spawn;
  sizeOf: (serial: string) => Promise<string>;
}

const realDeps: AdbDeps = {
  adb: () => bins().adb,
  spawn: (bin, args, opts) => nodeSpawn(bin, args, opts),
  sizeOf: (serial) => runText("adb", ["-s", serial, "shell", "wm", "size"], { timeout: 10_000 }),
};

/** The emulator as the line drives it, or null on a box without adb. A failure to read its size rejects. */
export async function openAdbScreen(serial: string, given: Partial<AdbDeps> = {}): Promise<LiveDevice | null> {
  const deps = { ...realDeps, ...given };
  const bin = deps.adb();
  if (!bin) return null;
  const size = wmSize(await deps.sizeOf(serial));
  const shell = deps.spawn(bin, ["-s", serial, "shell"], { stdio: ["pipe", "ignore", "ignore"] });
  shell.on("error", () => {});
  shell.stdin?.on("error", () => {});
  const write = (lines: string[]) => lines.forEach((line) => shell.stdin?.writable && shell.stdin.write(`${line}\n`));
  const gesture = gestureLines(size);
  const key = keyLines();
  const videos = new Set<() => void>();
  return {
    size,
    touch: (phase, x, y) => write(gesture(phase, x, y)),
    key: (code, down) => write(key(code, down)),
    text: (text) => write(textLines(text)),
    video: (onFrame, onEnd, quality = DEFAULT_QUALITY, bitrate) => {
      const stop = rollingVideo(recordWith(deps.spawn, bin, recordArgs(serial, size, quality, bitrate)), onFrame, () => {
        videos.delete(stop);
        onEnd();
      });
      videos.add(stop);
      return () => {
        videos.delete(stop);
        stop();
      };
    },
    close: () => {
      videos.forEach((stop) => stop());
      videos.clear();
      shell.stdin?.end();
      shell.kill();
    },
  };
}

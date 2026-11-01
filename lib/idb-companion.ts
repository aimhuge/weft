// A worker's line to the simulator (docs/architecture/weft-worker.md#the-fast-path): one idb_companion per watched
// device, spoken to over gRPC. It listens on a unix socket in a folder only this user can open and never on a TCP port,
// because the companion has no login of its own and a port would let the LAN drive the simulator.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { dropIdb, setIdb, type IdbSession } from "./idb-session";
import { findBin, TOOLS_DIR } from "./simulator-exec";

const READY_MS = 15_000;
const POLL_MS = 50;
// Thirty frames a second at full size: a pane on a retina screen draws a phone at about its own pixels, so anything
// smaller came out soft, and text is what QA reads. A key frame often enough to join quickly.
const VIDEO = { fps: 30, format: "H264", compression_quality: 0.85, avg_bitrate: 8_000_000, key_frame_rate: 2 };
const TARGET_SCALE = 1;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// The encoder silently sends nothing unless both sides come out even: 0.5 gets no video on an iPhone 16 (1179 wide) or a
// 16 Pro (1206, so 603), and full size gets none on the iPhone 16 either. This finds the scale nearest the target, never
// above 1, that lands on exact even numbers, measured on m1mini.
export function evenScale(width: number, height: number, target = TARGET_SCALE) {
  const step = 2 / gcd(width, height);
  const steps = Math.max(1, Math.min(Math.round(target / step), Math.floor(1 / step + 1e-9)));
  // The nudge keeps idb's rounding on the even side.
  return Math.min(1, step * steps + 1e-6);
}

export const companionBin = () =>
  findBin("idb_companion", [path.join(TOOLS_DIR, "idb-companion", "bin", "idb_companion"), path.join(os.homedir(), ".local", "opt", "idb", "idb-companion.universal", "bin", "idb_companion")]);

type Touch = { press: { action: { touch: { point: { x: number; y: number } } }; direction: "DOWN" | "UP" } };
type Sent = { write(event: unknown): unknown; end(): unknown };
type Video = Sent & { on(event: string, fn: (arg: never) => void): unknown; cancel(): void };
export interface IdbClient {
  describe(request: object, done: (err: Error | null, res?: Described) => void): void;
  hid(done: (err: Error | null) => void): Sent;
  video_stream(): Video;
  close(): void;
}
type Described = { target_description?: { screen_dimensions?: { width: number; height: number; density: number } } };

export async function connectIdb(socket: string): Promise<IdbClient> {
  const definition = await loader.load(fileURLToPath(new URL("./idb.proto", import.meta.url)), { keepCase: true, enums: String, longs: Number, defaults: true, oneofs: true });
  const { CompanionService } = (grpc.loadPackageDefinition(definition) as unknown as { idb: { CompanionService: new (url: string, creds: grpc.ChannelCredentials) => IdbClient } }).idb;
  return new CompanionService(`unix:${socket}`, grpc.credentials.createInsecure());
}

// The screen in points. A companion from before width_points only gives pixels and a density.
export function screenPoints(res: Described | undefined) {
  const s = res?.target_description?.screen_dimensions;
  if (!s?.width || !s.height || !s.density) throw new Error("idb didn't report the screen's size.");
  return { width: Math.round(s.width / s.density), height: Math.round(s.height / s.density) };
}

const touch = (point: { x: number; y: number }, direction: "DOWN" | "UP"): Touch => ({ press: { action: { touch: { point } }, direction } });

function hid(client: IdbClient, events: unknown[]) {
  return new Promise<void>((resolve, reject) => {
    const stream = client.hid((err) => (err ? reject(err) : resolve()));
    events.forEach((event) => stream.write(event));
    stream.end();
  });
}

function video(client: IdbClient, scale: number, onFrame: (frame: Buffer) => void, onEnd: () => void) {
  const stream = client.video_stream();
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    onEnd();
  };
  stream.on("data", (message: { payload?: { data?: Buffer } }) => {
    if (message.payload?.data?.length) onFrame(message.payload.data);
  });
  stream.on("error", end);
  stream.on("end", end);
  stream.write({ start: { ...VIDEO, scale_factor: scale } });
  return () => {
    done = true;
    stream.cancel();
  };
}

export function sessionOver(client: IdbClient, size: IdbSession["size"], close: () => void, scale = TARGET_SCALE): IdbSession {
  // A gesture holds one hid stream from its press to its release, so each move lands as it's written.
  let gesture: Sent | null = null;
  const live = () => client.hid(() => {});
  const keys = live();
  return {
    size,
    touch: (phase, x, y) => {
      if (phase === "down") gesture = live();
      gesture?.write(touch({ x, y }, phase === "up" ? "UP" : "DOWN"));
      if (phase === "up") {
        gesture?.end();
        gesture = null;
      }
    },
    key: (keycode, down) => keys.write({ press: { action: { key: { keycode } }, direction: down ? "DOWN" : "UP" } }),
    tap: (x, y) => hid(client, [touch({ x, y }, "DOWN"), touch({ x, y }, "UP")]),
    swipe: (start, end, ms) => hid(client, [{ swipe: { start, end, duration: ms / 1000, delta: 0 } }]),
    video: (onFrame, onEnd) => video(client, scale, onFrame, onEnd),
    close: () => {
      keys.end();
      close();
    },
  };
}

async function waitFor(file: string, child: ChildProcess, sleep: (ms: number) => Promise<unknown>) {
  for (let waited = 0; waited < READY_MS; waited += POLL_MS) {
    if (fs.existsSync(file)) return;
    if (child.exitCode !== null) throw new Error(`idb_companion exited with ${child.exitCode}.`);
    await sleep(POLL_MS);
  }
  throw new Error("idb_companion didn't start.");
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

// Null when idb_companion isn't installed: the watch then stays on the JPEG path. A failure rejects, and the caller
// does the same.
export async function openIdb(udid: string, connect = connectIdb, sleep = pause): Promise<IdbSession | null> {
  const bin = companionBin();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-idb-"));
  const socket = path.join(dir, "companion.sock");
  // Its frameworks load relative to the binary's folder, hence the cwd.
  const child = spawn(bin, ["--udid", udid, "--grpc-domain-sock", socket], { cwd: path.dirname(bin), stdio: "ignore" });
  child.on("error", () => {});
  let client: IdbClient | undefined;
  const cleanup = () => {
    client?.close();
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    await waitFor(socket, child, sleep);
    client = await connect(socket);
    const live = client;
    const res = await new Promise<Described | undefined>((resolve, reject) => live.describe({}, (err, out) => (err ? reject(err) : resolve(out))));
    const px = res?.target_description?.screen_dimensions;
    const session = sessionOver(
      live,
      screenPoints(res),
      () => {
        dropIdb(udid, session);
        cleanup();
      },
      evenScale(px?.width ?? 0, px?.height ?? 0),
    );
    setIdb(udid, session);
    // A companion that dies takes the fast taps with it; tapAt falls back to AXe.
    child.on("exit", () => dropIdb(udid, session));
    return session;
  } catch (err) {
    cleanup();
    throw err;
  }
}

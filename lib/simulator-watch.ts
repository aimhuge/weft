// Watching a device in the browser pane: a page in ~/.weft/show/simulator/<device>/ that reloads frame.jpg, and a
// loop here that keeps rewriting frame.jpg from the device's screenshots for a while. The page is a plain file the
// pane opens like any other show page, so the show rail lists it and lib/page-shots.ts pictures it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { globalSingleton } from "./global-singleton";
import { screenshot, type Device } from "./simulator-devices";
import { largestFrame, uiTree } from "./simulator-ui";
import { FRAME_MS, viewerHtml, type ScreenSize } from "./simulator-viewer";
import { SHOW_DIR } from "./show-dir";

export { FRAME_MS, viewerHtml };

// How long a watch keeps capturing after it starts (each watch call starts the clock again), and how often.
export const WATCH_MS = 10 * 60_000;
// Small enough to write every second, big enough to read a label.
const FRAME_WIDTH = 420;

// `live` is set once the page plays the window capture: frames stop, since nothing reads them.
// `size` is the screen in the units taps take, measured when the watch starts.
type Watch = { until: number; timer?: ReturnType<typeof setTimeout>; live?: boolean; size?: ScreenSize };
const watches = globalSingleton("__weftSimulatorWatches", () => new Map<string, Watch>());

export const watchDir = (d: Device) => path.join(SHOW_DIR, "simulator", d.id.replace(/[^\w.-]/g, "_"));

// The device's screen now, small enough to send.
export async function frameJpeg(d: Device, png?: Buffer) {
  return sharp(png ?? (await screenshot(d)))
    .resize({ width: FRAME_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
}

// One frame, written beside the page; written to a temp file first so the page never loads half a JPEG.
export async function writeFrame(d: Device, png?: Buffer) {
  const dir = watchDir(d);
  const jpg = await frameJpeg(d, png);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "frame.tmp.jpg");
  fs.writeFileSync(tmp, jpg);
  fs.renameSync(tmp, path.join(dir, "frame.jpg"));
}

function loop(d: Device, now: () => number) {
  const watch = watches.get(d.id);
  if (!watch) return;
  if (now() > watch.until) return void watches.delete(d.id);
  // The next frame waits for this one, so a slow device never piles captures up.
  void (watch.live ? Promise.resolve() : writeFrame(d))
    .catch(() => {})
    .finally(() => {
      if (watches.get(d.id) === watch) watch.timer = setTimeout(() => loop(d, now), FRAME_MS);
    });
}

// Starts (or extends) the live view of a device and returns the page's file URL.
export async function watch(d: Device, now: () => number = Date.now): Promise<string> {
  const until = now() + WATCH_MS;
  const dir = watchDir(d);
  const size = await screenSize(d);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), viewerHtml(d, until, size));
  await writeFrame(d);
  const running = watches.get(d.id);
  // A fresh page starts on the fallback frames until it says its capture plays.
  if (running) Object.assign(running, { until, size, live: false });
  else {
    const fresh: Watch = { until, size };
    watches.set(d.id, fresh);
    fresh.timer = setTimeout(() => loop(d, now), FRAME_MS);
  }
  return pathToFileURL(path.join(dir, "index.html")).href;
}

export function stopWatching(id?: string) {
  for (const [key, w] of watches) {
    if (id && key !== id) continue;
    clearTimeout(w.timer);
    watches.delete(key);
  }
}

export const watching = (id: string) => watches.has(id);

// The live page plays the window capture now; the loop stops writing frames.
export function markLive(id: string) {
  const w = watches.get(id);
  if (w) w.live = true;
}

export const watchedSize = (id: string) => watches.get(id)?.size;

// The screen in tap units (iOS points, Android pixels): the biggest frame in its UI tree. Undefined when the tree
// can't be read (AXe missing); the page then shows the whole window and doesn't take taps.
async function screenSize(d: Device): Promise<ScreenSize | undefined> {
  try {
    const f = largestFrame(await uiTree(d));
    return f.width > 0 && f.height > 0 ? { width: f.width, height: f.height } : undefined;
  } catch {
    return undefined;
  }
}

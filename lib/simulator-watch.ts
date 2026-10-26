// Watching a device in the browser pane: a page in ~/.weft/show/simulator/<device>/ that reloads frame.jpg, and a
// loop here that keeps rewriting frame.jpg from the device's screenshots for a while. The page is a plain file the
// pane opens like any other show page, so the show rail lists it and lib/page-shots.ts pictures it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { globalSingleton } from "./global-singleton";
import { screenshot, type Device } from "./simulator-devices";
import { SHOW_DIR } from "./show-dir";

// How long a watch keeps capturing after it starts (each watch call starts the clock again), and how often.
export const WATCH_MS = 10 * 60_000;
export const FRAME_MS = 1_000;
// Small enough to write every second, big enough to read a label.
const FRAME_WIDTH = 420;

type Watch = { until: number; timer?: ReturnType<typeof setTimeout> };
const watches = globalSingleton("__weftSimulatorWatches", () => new Map<string, Watch>());

export const watchDir = (d: Device) => path.join(SHOW_DIR, "simulator", d.id.replace(/[^\w.-]/g, "_"));

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function viewerHtml(d: Device, until: number) {
  const time = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const title = `${escape(d.name)}${d.runtime ? ` · ${escape(d.runtime)}` : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>📱 ${title}</title>
<style>
body{margin:0;min-height:100vh;background:#0f1115;color:#cfd3da;font:13px -apple-system,system-ui;display:flex;flex-direction:column;align-items:center}
header{display:flex;gap:10px;align-items:center;padding:12px 0}
.dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80}
.off .dot{background:#6b7280;box-shadow:none}
img{max-height:calc(100vh - 70px);max-width:94vw;border-radius:22px;border:6px solid #23272f;background:#000}
small{color:#7b818c}
</style></head><body>
<header><span class="dot"></span><b>${title}</b><small id="s">live until ${time}</small></header>
<img id="f" alt="${escape(d.name)}'s screen">
<script>
const until=${until},img=document.getElementById("f"),s=document.getElementById("s");
function next(){if(Date.now()>until){document.body.classList.add("off");s.textContent="paused: ask the thread to watch again";return}img.src="frame.jpg?"+Date.now()}
img.onload=()=>setTimeout(next,${FRAME_MS});img.onerror=()=>setTimeout(next,${FRAME_MS * 2});next();
</script></body></html>`;
}

// One frame, written beside the page; written to a temp file first so the page never loads half a JPEG.
export async function writeFrame(d: Device, png?: Buffer) {
  const dir = watchDir(d);
  const jpg = await sharp(png ?? (await screenshot(d)))
    .resize({ width: FRAME_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
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
  void writeFrame(d)
    .catch(() => {})
    .finally(() => {
      if (watches.get(d.id) === watch) watch.timer = setTimeout(() => loop(d, now), FRAME_MS);
    });
}

// Starts (or extends) the live view of a device and returns the page's file URL.
export async function watch(d: Device, now: () => number = Date.now): Promise<string> {
  const until = now() + WATCH_MS;
  const dir = watchDir(d);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), viewerHtml(d, until));
  await writeFrame(d);
  const running = watches.get(d.id);
  if (running) running.until = until;
  else {
    const fresh: Watch = { until };
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

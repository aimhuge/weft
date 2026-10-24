#!/usr/bin/env node
// Capture frames of one feature intro: headless Chrome screenshots the paused GSAP timeline once per frame
// (public/intros/<id>.html?t=<s>, the same seek the contact sheet uses) into a kept frames dir, so
// scripts/encode-intros.sh can turn them into an mp4. ffmpeg's encode has to run from the shell, not through
// execFileSync here.
//
//   node scripts/render-intros.mjs <id> [fps] [portrait] [--fresh]
//
// The frames land in scripts/../build/intros/frames by default; INTROS_DIR points at the compositions when
// they live somewhere else (a Mac mini that has the sources synced but not the whole repo), and OUT_DIR moves
// the frames and the finished video.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// The compositions live in the repo locally; a Mac mini that renders for us has them synced to its own folder,
// so the path comes from the environment and falls back to the repo.
const intros = process.env.INTROS_DIR || resolve(import.meta.dirname, "..", "public", "intros");
const out = process.env.OUT_DIR || resolve(import.meta.dirname, "..", "build", "intros");
const id = process.argv[2];
if (!id) throw new Error("usage: node scripts/render-intros.mjs <id> [fps] [portrait] [--fresh]");
const fps = Number(process.argv[3] ?? 12);
// portrait renders 1080x1920 (9:16) instead of the authored 800x1000, centring the art on the taller stage.
const portrait = process.argv[4] === "portrait";
const [W, H] = portrait ? [1080, 1920] : [800, 1000];
const src = join(intros, `${id}.html`);
const duration = Number(/data-duration="([\d.]+)"/.exec(readFileSync(src, "utf8"))?.[1] ?? 20);
// Every intro opens on the splash screen that player.js injects, so the video is the splash plus the story.
// The splash holds for 1.5 s and fades over 0.5 s; the story then runs its own length.
const LEAD = 2.0;
const frames = Math.round((duration + LEAD) * fps);

const dir = join(out, "frames", `${id}-${fps}${portrait ? "-p" : ""}`);
// Resumable: a frame already on disk is kept, so an interrupted render picks up where it stopped. Pass --fresh
// to wipe the directory first (after a change to the composition or the kit, the old frames are stale).
const fresh = process.argv.includes("--fresh");
if (fresh) rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
// A frame captured before the kit changed is stale even though it's on disk, so the resume can't hand back a
// video built from the old composition. The kit's mtime is the marker: any frame older than it is recaptured.
const kit = join(intros, "player.js");
const kitTime = statSync(kit).mtimeMs;
process.stdout.write(`${id}: ${frames} frames at ${fps}fps, ${W}x${H} (${duration}s + ${LEAD}s splash)\n`);
for (let i = 0; i < frames; i++) {
  const file = join(dir, `f${String(i).padStart(4, "0")}.png`);
  // A frame from an interrupted run can be truncated; only a readable one counts as done. One older than the
  // kit counts as not done either, because it was captured against the composition as it was before.
  //
  // A frame that is there but blank doesn't count as done either. If the page didn't load (a missing GSAP
  // beside the sources, say) the capture still writes a file — the background — so the resume would hand back a
  // reel of nothing and call it finished. A real frame is well over 30 KB; a blank one is about 10 KB.
  if (!fresh && existsSync(file)) {
    const size = statSync(file).size;
    if (size > 30000 && statSync(file).mtimeMs >= kitTime) continue;
  }
  // The frame sits at this point on the master timeline. player.js maps ?t= to the story's own clock, so the
  // splash's seconds are asked for directly and the story's seconds are asked for as they are.
  const master = (i + 0.5) / fps;
  const t = master < LEAD ? master : master - LEAD;
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
    "--virtual-time-budget=900", `--screenshot=${file}`,
    `--window-size=${W},${H}`, `file://${src}?t=${t.toFixed(4)}${portrait ? "&ratio=9:16" : ""}`], { stdio: "ignore" });
}
console.log(dir);

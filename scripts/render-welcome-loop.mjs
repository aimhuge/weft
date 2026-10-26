#!/usr/bin/env node
// Renders Weft's two video cuts from the HyperFrames compositions in public/welcome/ (https://hyperframes.heygen.com):
//   public/brand/welcome-loop.mp4  the welcome's 26 s loop (loop.html): a card from prompt to Done
//   public/brand/weft-tour.mp4     weft.zip's ~100 s tour: intro.html (Welcome to Weft), that loop, beats.html up to its
//                                  keyboard shortcuts (tools, vault, panes, quality, BlastCP, profile, open source), then
//                                  outro.html (download Weft), since shortcuts only help once it's installed
// Needs ffmpeg (brew install ffmpeg); HyperFrames brings its own Chrome. Each composition is copied to a temp folder as
// index.html, since `hyperframes render` renders a project folder; ffmpeg trims beats at the "keys" scene (faded out)
// and joins the four (all 1920x800, 30 fps, AAC voiceover). Run `pnpm welcome:narrate` first after changing a caption,
// so the voice matches.
//   pnpm welcome:render                      default names (my-app, api, site; @you)
//   pnpm welcome:render -- --projects=a,b,c  other project names on the loop's cards
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HYPERFRAMES = "hyperframes@0.8.186";
const root = resolve(import.meta.dirname, "..");
const src = join(root, "public/welcome");
const brand = join(root, "public/brand");
const projects = process.argv.find((a) => a.startsWith("--projects="))?.slice("--projects=".length);

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1" } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// One composition to one MP4.
function render(file, out, variables) {
  const dir = mkdtempSync(join(tmpdir(), "weft-welcome-"));
  try {
    // What the pages load (gsap, live.js, backgrounds, voice tracks), then this page as index.html. The other pages
    // stay out: HyperFrames treats every root HTML file as an entry point and could play their audio too.
    for (const name of readdirSync(src)) if (!name.endsWith(".html")) copyFileSync(join(src, name), join(dir, name));
    copyFileSync(join(src, file), join(dir, "index.html"));
    const args = ["-y", HYPERFRAMES, "render", "--quality", "high", "--fps", "30", "-o", out];
    if (variables) args.push("--variables", JSON.stringify(variables));
    run("npx", args, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Where beats.html's keyboard shortcuts start, from its SCENES list (each [beat, element, seconds, draw]): the sum of
// the scenes before "keys", or the whole page if it has none.
function keysStart(html) {
  const list = html.slice(html.indexOf("var SCENES"));
  let at = 0;
  for (const [, beat, length] of list.matchAll(/\["(\w+)", "#\w+", ([\d.]+)/g)) {
    if (beat === "keys") return Math.round(at * 100) / 100;
    at += Number(length);
  }
  return null;
}

// intro + loop + beats (cut at `cut` seconds, its last 0.6 s faded) + outro, re-encoded as one MP4.
function join4([intro, loopMp4, beatsMp4, outro], cut, out) {
  const fade = cut === null ? "" : `,trim=0:${cut},setpts=PTS-STARTPTS,fade=t=out:st=${cut - 0.6}:d=0.6`;
  const afade = cut === null ? "" : `,atrim=0:${cut},asetpts=PTS-STARTPTS,afade=t=out:st=${cut - 0.6}:d=0.6`;
  const graph = `[2:v]null${fade}[bv];[2:a]anull${afade}[ba];[0:v][0:a][1:v][1:a][bv][ba][3:v][3:a]concat=n=4:v=1:a=1[v][a]`;
  const inputs = [intro, loopMp4, beatsMp4, outro].flatMap((f) => ["-i", f]);
  run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", out], root);
}

const loop = join(brand, "welcome-loop.mp4");
const tour = join(brand, "weft-tour.mp4");
const work = mkdtempSync(join(tmpdir(), "weft-tour-"));
try {
  render("loop.html", loop, projects ? { projects } : undefined);
  const intro = join(work, "intro.mp4");
  const beats = join(work, "beats.mp4");
  render("intro.html", intro);
  render("beats.html", beats);
  const outro = join(work, "outro.mp4");
  render("outro.html", outro);
  join4([intro, loop, beats, outro], keysStart(readFileSync(join(src, "beats.html"), "utf8")), tour);
  console.log(`Rendered ${loop}\nRendered ${tour}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

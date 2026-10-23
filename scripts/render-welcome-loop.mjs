#!/usr/bin/env node
// Renders Weft's two video cuts from the HyperFrames compositions in public/welcome/ (https://hyperframes.heygen.com):
//   public/brand/welcome-loop.mp4  the welcome's 30 s loop (loop.html): a card from prompt to Done, with the 🔐 vault
//   public/brand/weft-tour.mp4     weft.zip's 96 s tour: intro.html (Welcome to Weft), that loop, then beats.html
//                                  (connect your tools, Wefter Profile, code quality, "Now let's get started")
// Needs ffmpeg (brew install ffmpeg); HyperFrames brings its own Chrome. Each composition is copied to a temp folder as
// index.html, since `hyperframes render` renders a project folder; ffmpeg's concat demuxer joins the three without
// re-encoding (both are 1920x800, 30 fps, AAC voiceover, from the same encoder). Run `pnpm welcome:narrate` first after
// changing a caption, so the voice matches.
//   pnpm welcome:render                      default names (my-app, api, site; @you)
//   pnpm welcome:render -- --projects=a,b,c  other project names on the loop's cards
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

const loop = join(brand, "welcome-loop.mp4");
const tour = join(brand, "weft-tour.mp4");
const work = mkdtempSync(join(tmpdir(), "weft-tour-"));
try {
  render("loop.html", loop, projects ? { projects } : undefined);
  const intro = join(work, "intro.mp4");
  const beats = join(work, "beats.mp4");
  render("intro.html", intro);
  render("beats.html", beats);
  const list = join(work, "list.txt");
  writeFileSync(list, [intro, loop, beats].map((f) => `file '${f}'`).join("\n") + "\n");
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tour], root);
  console.log(`Rendered ${loop}\nRendered ${tour}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

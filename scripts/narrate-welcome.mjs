#!/usr/bin/env node
// Voices the welcome tour: one Kokoro clip per caption (https://github.com/hexgrad/kokoro, local, no key), placed at its
// time by ffmpeg into one track per composition (public/welcome/narration-intro.m4a, -loop.m4a, -beats.m4a for
// intro.html, loop.html, beats.html), plus one clip for each of the welcome's later steps (-projects.m4a, -first.m4a). The compositions carry them as HyperFrames <audio> clips, so
// `pnpm welcome:render` bakes the voice into the MP4s; in the app, components/WelcomeLoop.tsx plays the track of the
// page on screen. kokoro-js lives in ~/.cache/weft-kokoro, outside the repo (installed there on first run; the model,
// ~80 MB, downloads once to the Hugging Face cache). Each tour page's track also carries a soft backing pad made by
// ffmpeg (bedSource below). Needs ffmpeg.
//   pnpm welcome:narrate                 af_heart
//   pnpm welcome:narrate -- --voice=am_michael
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Each line starts where its caption does, or just after the line before it if that one is still talking, and should
// end by its `end` (the script warns when it runs over, so a caption and its line don't drift apart).
const NARRATION = {
  intro: {
    duration: 12,
    lines: [
      [0.3, 2.1, "Welcome to Weft."],
      [2.1, 5.3, "Weft is the future of AI engineering."],
      [5.3, 11.4, "Weft runs on top of Claude Code, Codex, and other agent see-ell-eyes like Puku AI."],
    ],
  },
  loop: {
    duration: 30,
    lines: [
      [0, 3.2, "Every card in Weft is an AI coding thread."],
      [3.2, 10, "Click a card to open its thread. Weft shows its work in the browser pane."],
      [10.2, 13.6, "When a Weft card needs a decision, it moves to the Needs you column."],
      [13.8, 20, "Your keys live in your vault. Touch ID safely lets your AI use them."],
      [21, 23.6, "Check Weft's work in the Review column."],
      [23.6, 29, "Moving a card to the Done column commits, refactors and deploys."],
    ],
  },
  beats: {
    duration: 36,
    lines: [
      [0.5, 7, "Connect your tools to Weft, so your threads can use them."],
      [7.5, 16.3, "Panes aren't just previews. They can use your vault, connect to your data, and be shared, so a live dashboard, mini-app or game is just a few clicks away."],
      [17, 23.5, "Share your Wefter Profile, and show the world what you ship."],
      [24.5, 31, "Weft also scores your code quality, and Weft's scout keeps your code clean."],
      [31.8, 35, "Now let's get started."],
    ],
  },
  // The welcome's later steps: one line each, played as the step opens (components/WelcomeDialog.tsx), not looped.
  projects: { lines: [[0, 4, "Allow Weft to see your projects."]] },
  first: { lines: [[0, 4, "Now start a new thread."]] },
};

const root = resolve(import.meta.dirname, "..");
const cache = join(homedir(), ".cache", "weft-kokoro");
const voice = process.argv.find((a) => a.startsWith("--voice="))?.slice("--voice=".length) ?? "af_heart";

async function loadKokoro() {
  if (!existsSync(join(cache, "node_modules", "kokoro-js"))) {
    mkdirSync(cache, { recursive: true });
    execFileSync("npm", ["install", "--prefix", cache, "kokoro-js@1"], { stdio: "inherit" });
  }
  const entry = createRequire(join(cache, "package.json")).resolve("kokoro-js");
  const { KokoroTTS } = await import(pathToFileURL(entry).href);
  return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
}

// The backing track: a soft pad, Am F C G, one chord every 4 s, each swelling in and out (so a chord change never
// clicks), warmed with a lowpass and an echo and faded at both ends. Made by ffmpeg from sine waves, so there's no
// license to track. It sits well under the voice (BED_GAIN) and only under the tour's pages, not the steps' lines.
const BED_GAIN = 0.65;
const CHORDS = [
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [261.63, 329.63, 392],
  [196, 246.94, 293.66],
];
function bedSource(duration) {
  const c = "mod(floor(t/4),4)";
  const pick = (i) => CHORDS.reduceRight((rest, chord, n) => (n === CHORDS.length - 1 ? `${chord[i]}` : `if(eq(${c},${n}),${chord[i]},${rest})`), "");
  const [f1, f2, f3] = [0, 1, 2].map(pick);
  const tone = `sin(2*PI*${f1}*t)+sin(2*PI*${f2}*t)+0.8*sin(2*PI*${f3}*t)+0.7*sin(PI*${f1}*t)`;
  const swell = "(0.5-0.5*cos(2*PI*mod(t,4)/4))";
  return `aevalsrc='0.08*(${tone})*${swell}':s=44100:d=${duration}`;
}
const bedFilter = (duration) =>
  `lowpass=f=1600,aecho=0.8:0.7:180|360:0.35|0.2,volume=${BED_GAIN},afade=t=in:d=1.5,afade=t=out:st=${duration - 1.5}:d=1.5`;

const seconds = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

const tts = await loadKokoro();
const work = mkdtempSync(join(tmpdir(), "weft-narrate-"));
try {
  for (const [page, { duration, lines }] of Object.entries(NARRATION)) {
    const clips = [];
    let free = 0;
    for (const [i, [cue, end, text]] of lines.entries()) {
      const file = join(work, `${page}-${i}.wav`);
      await (await tts.generate(text, { voice, speed: 1.1 })).save(file);
      const start = Math.max(cue, free);
      free = start + seconds(file) + 0.2;
      if (free - 0.2 > end) console.warn(`! ${page} line ${i + 1} runs ${(free - 0.2 - end).toFixed(1)}s past ${end}s: "${text}"`);
      clips.push({ file, start });
    }
    // Each clip delayed to its start, mixed without level changes, then padded and cut to the composition's length; a
    // step's clip (no duration) just ends when it ends.
    const fit = duration ? `,apad,atrim=0:${duration}` : "";
    const voices = clips.map((c, i) => `[${i}:a]adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`);
    const labels = clips.map((_, i) => `[a${i}]`);
    const inputs = clips.flatMap((c) => ["-i", c.file]);
    if (duration) {
      inputs.push("-f", "lavfi", "-i", bedSource(duration));
      voices.push(`[${clips.length}:a]${bedFilter(duration)}[bed]`);
      labels.push("[bed]");
    }
    const filter = `${voices.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0${fit}[out]`;
    const out = join(root, "public", "welcome", `narration-${page}.m4a`);
    const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "aac", "-b:a", "128k", out];
    const run = spawnSync("ffmpeg", args, { stdio: "inherit" });
    if (run.status !== 0) process.exit(run.status ?? 1);
    console.log(`Narrated ${out} (${seconds(out).toFixed(1)}s, ${voice})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

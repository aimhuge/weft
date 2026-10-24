// The voice pipeline the welcome tour (scripts/narrate-welcome.mjs) and the feature intros (scripts/narrate-intros.mjs)
// share: one Kokoro clip per line (https://github.com/hexgrad/kokoro, local, no key), placed at its time by ffmpeg into
// one track, with a soft backing pad under tracks that have a length. kokoro-js lives in ~/.cache/weft-kokoro, outside
// the repo (installed there on first run; the model, ~80 MB, downloads once to the Hugging Face cache). Needs ffmpeg.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cache = join(homedir(), ".cache", "weft-kokoro");

export const voiceArg = () => process.argv.find((a) => a.startsWith("--voice="))?.slice("--voice=".length) ?? "af_heart";

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
// license to track. It sits well under the voice (BED_GAIN) and only under tracks with a duration, not single lines.
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

// When a line's clip comes out at `clipSeconds`, where each word in it starts. Kokoro reads at a steady rate, so the
// words share the clip in proportion to how long each takes to say, with a little weight on the word's length (long
// words take longer) — good enough to drive a word-by-word caption highlight, and always in step with the real audio
// because the length it divides IS the measured length of the clip that plays.
function wordTimes(text, clipSeconds, start) {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.replace(/[^A-Za-z0-9']/g, "").length || 1);
  // Punctuation rides with its word and doesn't add time of its own.
  const total = weights.reduce((a, b) => a + b, 0);
  let at = start;
  return words.map((w, i) => {
    const t = at;
    at += (weights[i] / total) * clipSeconds;
    return [w, Number(t.toFixed(3))];
  });
}

// Voices every track: `tracks` maps a name to { duration?, lines: [[cue, end, text], ...] }, `outFor(name)` says where
// its .m4a goes. Each line starts at its cue, or just after the line before it if that one is still talking, and should
// end by its `end`; it warns when one runs over, so a caption and its line don't drift apart.
export async function narrate(tracks, outFor, voice = voiceArg()) {
  const tts = await loadKokoro();
  const work = mkdtempSync(join(tmpdir(), "weft-narrate-"));
  try {
    for (const [name, { duration, lines }] of Object.entries(tracks)) {
      const clips = [];
      const timings = [];
      let free = 0;
      for (const [i, [cue, end, text]] of lines.entries()) {
        const file = join(work, `${name}-${i}.wav`);
        await (await tts.generate(text, { voice, speed: 1.1 })).save(file);
        const start = Math.max(cue, free);
        const len = seconds(file);
        free = start + len + 0.2;
        if (free - 0.2 > end) console.warn(`! ${name} line ${i + 1} runs ${(free - 0.2 - end).toFixed(1)}s past ${end}s: "${text}"`);
        clips.push({ file, start });
        timings.push(...wordTimes(text, len, start));
      }
      // Each clip delayed to its start, mixed without level changes, then padded and cut to the track's length; a
      // single line (no duration) just ends when it ends.
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
      const out = outFor(name);
      const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:a", "aac", "-b:a", "128k", out];
      const run = spawnSync("ffmpeg", args, { stdio: "inherit" });
      if (run.status !== 0) process.exit(run.status ?? 1);
      // The word timings beside the track, for the word-by-word caption highlight (public/welcome/live.js reads this).
      // The lines go in too, so a composition knows which caption is which line without repeating the copy.
      const words = out.replace(/\.m4a$/, ".words.json");
      writeFileSync(words, `${JSON.stringify({ duration: duration ?? 0, lines: lines.map(([cue, end, text]) => [cue, end, text]), words: timings }, null, 1)}\n`);
      console.log(`Narrated ${out} (${seconds(out).toFixed(1)}s, ${voice}) + ${words}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

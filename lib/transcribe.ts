import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { whisperLanguage } from "./dictation-languages";
import { readDictationPrefs, vocabularyPrompt } from "./dictation-prefs";
import { downloadState, MODEL_FILE, serverModel } from "./whisper-model";
import { serverTranscribe, warmServer } from "./whisper-server";

// Dictation runs whisper.cpp on this machine: the desktop app's Chromium has no speech service, and
// local transcription keeps what you say on your Mac. Needs `brew install whisper-cpp ffmpeg` and a model.

const run = promisify(execFile);

const SUPERWHISPER = path.join(os.homedir(), "Library/Application Support/superwhisper");
const BREW = "/opt/homebrew/share/whisper-cpp";

// Best first. WEFT_WHISPER_MODEL picks one explicitly.
const MODELS = [
  process.env.WEFT_WHISPER_MODEL,
  MODEL_FILE,
  path.join(SUPERWHISPER, "ggml-large-v3-turbo.bin"),
  path.join(SUPERWHISPER, "ggml-medium.bin"),
  path.join(SUPERWHISPER, "ggml-small.bin"),
  path.join(SUPERWHISPER, "ggml-small.en.bin"),
  path.join(SUPERWHISPER, "ggml-base.bin"),
  path.join(BREW, "ggml-large-v3-turbo.bin"),
  path.join(BREW, "ggml-medium.bin"),
  path.join(BREW, "ggml-small.bin"),
  path.join(BREW, "ggml-base.bin"),
  path.join(BREW, "ggml-base.en.bin"),
];

function which(bin: string) {
  try {
    return execFileSync("/usr/bin/which", [bin], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

interface Tools {
  whisper: string;
  ffmpeg: string;
  model: string;
}

let cached: { tools: Tools | null; reason?: string; at: number } | undefined;

// What dictation needs, looked up once a minute at most.
function tools(): { tools: Tools | null; reason?: string } {
  if (cached && Date.now() - cached.at < 60_000) return cached;
  const whisper = which("whisper-cli");
  const ffmpeg = which("ffmpeg");
  const model = MODELS.find((m) => m && fs.existsSync(m));
  let reason: string | undefined;
  if (!whisper) reason = "Dictation needs whisper.cpp: brew install whisper-cpp";
  else if (!ffmpeg) reason = "Dictation needs ffmpeg: brew install ffmpeg";
  else if (!model) reason = `Dictation needs a whisper model, e.g. ggml-base.en.bin in ${BREW}`;
  cached = { tools: whisper && ffmpeg && model ? { whisper, ffmpeg, model } : null, reason, at: Date.now() };
  return cached;
}

export function dictationStatus() {
  const { tools: found, reason } = tools();
  return { available: Boolean(found), reason, model: found ? path.basename(found.model) : undefined };
}

// Advanced dictation's side: whether whisper-server is installed, and the model it would keep loaded.
export function advancedStatus() {
  const model = serverModel();
  return {
    server: Boolean(which("whisper-server")),
    model: model ? path.basename(model) : undefined,
    download: downloadState(),
  };
}

// Starts the warm server ahead of a recording when Advanced dictation is on, so it's ready by Stop.
export function warmIfAdvanced() {
  if (!readDictationPrefs().advanced) return;
  const bin = which("whisper-server");
  const model = serverModel();
  if (bin && model) warmServer(bin, model).catch(() => {});
}

// Seconds of speech in a 16 kHz, 16-bit mono WAV.
export function wavSeconds(wav: string) {
  return Math.max(0, fs.statSync(wav).size - 44) / 32_000;
}

// whisper's encoder pads every clip to 30 s (1500 frames, 50 a second). A short clip gets a window
// its own length plus 3 s of slack instead, which roughly halves the work; long clips gain little.
export function audioCtx(seconds: number) {
  if (seconds > 20) return 0;
  return Math.min(1500, Math.max(384, Math.ceil(((seconds + 3) * 50) / 64) * 64));
}

// A shortened window now and then makes whisper loop: the same six words twice is that, not speech.
export function looksBroken(text: string) {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const seen = new Set<string>();
  for (let i = 0; i + 6 <= words.length; i++) {
    const run = words.slice(i, i + 6).join(" ");
    if (seen.has(run)) return true;
    seen.add(run);
  }
  return false;
}

function clean(stdout: string) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    // whisper marks silence and noise like [BLANK_AUDIO] or (wind blowing).
    .replace(/\[[A-Z_ ]+\]|\((?:[a-z ]+)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One pass over the WAV: the warm server when Advanced dictation has one, else a fresh whisper-cli.
async function pass(found: Tools, wav: string, language: string, ctx: number, prompt: string) {
  if (readDictationPrefs().advanced) {
    const bin = which("whisper-server");
    const model = serverModel();
    if (bin && model) {
      try {
        return clean(await serverTranscribe(bin, model, wav, { language, audioCtx: ctx, prompt }));
      } catch {
        // The server failed: the CLI still works.
      }
    }
  }
  const threads = String(Math.max(2, Math.min(8, os.availableParallelism() - 1)));
  const args = ["-m", found.model, "-f", wav, "-l", language, "-nt", "-np", "-t", threads, ...(ctx ? ["-ac", String(ctx)] : []), ...(prompt ? ["--prompt", prompt] : [])];
  const { stdout } = await run(found.whisper, args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  return clean(stdout);
}

// Turns a recording (any format ffmpeg reads) into text. requested is the board's language ("en-US"),
// used when the setting is the system language.
export async function transcribe(audio: Buffer, ext = "webm", requested?: string | null): Promise<string> {
  const { tools: found, reason } = tools();
  if (!found) throw new Error(reason);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `weft-dictation-${randomUUID().slice(0, 8)}-`));
  try {
    const input = path.join(dir, `input.${ext.replace(/[^a-z0-9]/gi, "") || "webm"}`);
    const wav = path.join(dir, "audio.wav");
    fs.writeFileSync(input, audio);
    await run(found.ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], {
      timeout: 60_000,
    });
    const prefs = readDictationPrefs();
    const language = whisperLanguage(prefs.language, requested);
    const prompt = vocabularyPrompt(prefs.vocabulary);
    const ctx = audioCtx(wavSeconds(wav));
    const text = await pass(found, wav, language, ctx, prompt);
    // The short window looped or heard nothing: run again over the full 30 s one.
    return ctx && looksBroken(text) ? await pass(found, wav, language, 0, prompt) : text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

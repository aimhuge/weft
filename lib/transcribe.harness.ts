// The fake whisper.cpp, ffmpeg, `which`, dictation settings and warm server the transcribe tests
// run against. Nothing is ever transcribed for real and no port is ever opened.
import fs from "node:fs";
import { vi } from "vitest";

interface HarnessState {
  // Which binaries exist, what whisper-cli answers, and which binary should crash.
  sys: { bins: Record<string, string>; stdout: string; fail: string | null };
  // The dictation settings (lib/dictation-prefs.ts).
  prefs: { value: { language: string; advanced: boolean; vocabulary: string } };
  // The model Advanced dictation would keep loaded, and its download's state (lib/whisper-model.ts).
  model: { file: string | undefined; download: { downloading: boolean; received: number; total: number } };
  // The warm server (lib/whisper-server.ts).
  server: {
    transcribe: ReturnType<
      typeof vi.fn<(bin: string, m: string, wav: string, opts: { language: string; audioCtx: number; prompt: string }) => Promise<string>>
    >;
    warm: ReturnType<typeof vi.fn<(bin: string, m: string) => Promise<unknown>>>;
  };
}

// vi.hoisted can't be exported, so the state lives here and the test files read it through these.
const state = vi.hoisted<HarnessState>(() => ({
  sys: { bins: {}, stdout: "", fail: null },
  prefs: { value: { language: "system", advanced: false, vocabulary: "" } },
  model: { file: undefined, download: { downloading: false, received: 0, total: 0 } },
  server: {
    transcribe: vi.fn<(bin: string, m: string, wav: string, opts: { language: string; audioCtx: number; prompt: string }) => Promise<string>>(),
    warm: vi.fn<(bin: string, m: string) => Promise<unknown>>(),
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((_which: string, [bin = ""]: string[]) => {
    if (!(bin in state.sys.bins)) throw new Error("not found");
    return `${state.sys.bins[bin]}\n`;
  }),
  execFile: vi.fn(),
}));

vi.mock("./dictation-prefs", () => ({
  readDictationPrefs: () => ({ ...state.prefs.value }),
  vocabularyPrompt: (vocabulary: string) => {
    const terms = vocabulary
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    return terms.length ? `${terms.join(", ")}.` : "";
  },
}));

vi.mock("./whisper-model", () => ({
  MODEL_FILE: "/nonexistent/ggml-large-v3-turbo-q5_0.bin",
  serverModel: () => state.model.file,
  downloadState: () => ({ ...state.model.download }),
}));

vi.mock("./whisper-server", () => ({
  serverTranscribe: (...args: Parameters<typeof state.server.transcribe>) => state.server.transcribe(...args),
  warmServer: (...args: Parameters<typeof state.server.warm>) => state.server.warm(...args),
}));

export const sys = state.sys;
export const prefs = state.prefs;
export const modelState = state.model;
export const server = state.server;

// The default fake: ffmpeg writes the WAV the next step reads, whisper-cli answers with sys.stdout.
export function defaultExecFile(bin: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: unknown) => void) {
  if (sys.fail === bin) {
    cb(new Error(`${bin} crashed`));
    return;
  }
  const out = args[args.length - 1];
  if (bin.endsWith("ffmpeg") && out !== undefined) fs.writeFileSync(out, Buffer.alloc(44 + 32_000 * 2));
  cb(null, { stdout: bin.endsWith("whisper-cli") ? sys.stdout : "", stderr: "" });
}

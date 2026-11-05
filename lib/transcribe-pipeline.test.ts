import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExecFile, modelState, prefs, server, sys } from "./transcribe.harness";

// The transcription itself: the WAV whisper gets, the language and vocabulary it is given, and the
// warm server Advanced dictation runs on. The fakes come from lib/transcribe.harness.ts.
let dir: string;
let model: string;
let child: typeof import("node:child_process");

async function load() {
  vi.resetModules();
  child = await import("node:child_process");
  vi.mocked(child.execFile).mockImplementation(defaultExecFile as never);
  return import("./transcribe");
}

const allTools = () => (sys.bins = { "whisper-cli": "/bin/whisper-cli", ffmpeg: "/bin/ffmpeg" });
const call = (bin: string) => vi.mocked(child.execFile).mock.calls.find(([b]) => b === bin)!;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dictation-test-"));
  model = path.join(dir, "ggml-test.bin");
  fs.writeFileSync(model, "");
  process.env.WEFT_WHISPER_MODEL = model;
  sys.bins = {};
  sys.stdout = "";
  sys.fail = null;
  prefs.value = { language: "system", advanced: false, vocabulary: "" };
  modelState.file = undefined;
  server.transcribe.mockReset();
  server.warm.mockReset();
  server.transcribe.mockResolvedValue("from the server");
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.WEFT_WHISPER_MODEL;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("transcribe", () => {
  it("refuses with the setup reason when dictation can't run", async () => {
    const { transcribe } = await load();
    await expect(transcribe(Buffer.from("a"))).rejects.toThrow("Dictation needs whisper.cpp");
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("converts to 16 kHz mono WAV, runs whisper on the model, and cleans its output", async () => {
    allTools();
    vi.spyOn(os, "availableParallelism").mockReturnValue(4);
    sys.stdout = "[BLANK_AUDIO]\n  Hello there,  \n(wind blowing) world.\n[MUSIC PLAYING]\n";
    const { transcribe } = await load();
    let input = "";
    vi.mocked(child.execFile).mockImplementationOnce(((_bin: string, args: string[], _o: unknown, cb: (e: null, o: unknown) => void) => {
      input = args[args.indexOf("-i") + 1]!;
      expect(fs.readFileSync(input, "utf8")).toBe("audio bytes");
      fs.writeFileSync(args[args.length - 1]!, Buffer.alloc(44 + 32_000 * 2));
      cb(null, { stdout: "" });
    }) as never);

    expect(await transcribe(Buffer.from("audio bytes"), "m4a")).toBe("Hello there, world.");

    expect(path.basename(input)).toBe("input.m4a");
    const wav = path.join(path.dirname(input), "audio.wav");
    expect(call("/bin/ffmpeg").slice(1, 3)).toEqual([
      ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      { timeout: 60_000 },
    ]);
    expect(call("/bin/whisper-cli").slice(1, 3)).toEqual([
      ["-m", model, "-f", wav, "-l", "en", "-nt", "-np", "-t", "3", "-ac", "384"],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    ]);
    expect(fs.existsSync(path.dirname(input))).toBe(false); // temp folder removed
  });

  it("asks whisper for the language the request names", async () => {
    allTools();
    const { transcribe } = await load();
    await transcribe(Buffer.from("a"), "webm", "fr-FR");
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args[args.indexOf("-l") + 1]).toBe("fr");
  });

  it("asks whisper for the language the setting names", async () => {
    allTools();
    prefs.value.language = "de";
    const { transcribe } = await load();
    await transcribe(Buffer.from("a"), "webm", "fr-FR");
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args[args.indexOf("-l") + 1]).toBe("de");
  });

  it("asks whisper to detect each time when the setting says so", async () => {
    allTools();
    prefs.value.language = "auto";
    const { transcribe } = await load();
    await transcribe(Buffer.from("a"), "webm", "fr-FR");
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args[args.indexOf("-l") + 1]).toBe("auto");
  });

  it("passes the vocabulary to whisper as its prompt", async () => {
    allTools();
    prefs.value.vocabulary = "Weft, Supabase";
    const { transcribe } = await load();
    await transcribe(Buffer.from("a"));
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args[args.indexOf("--prompt") + 1]).toBe("Weft, Supabase.");
  });

  it("leaves the prompt out when the vocabulary is empty", async () => {
    allTools();
    const { transcribe } = await load();
    await transcribe(Buffer.from("a"));
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args).not.toContain("--prompt");
  });

  it("uses between 2 and 8 threads", async () => {
    allTools();
    const { transcribe } = await load();
    const threads = () => {
      const args = call("/bin/whisper-cli")[1] as string[];
      return args[args.indexOf("-t") + 1];
    };
    vi.spyOn(os, "availableParallelism").mockReturnValue(1);
    await transcribe(Buffer.from("a"));
    expect(threads()).toBe("2");
    vi.clearAllMocks();
    vi.spyOn(os, "availableParallelism").mockReturnValue(32);
    await transcribe(Buffer.from("a"));
    expect(threads()).toBe("8");
  });

  it("strips odd characters from the extension, defaulting to webm", async () => {
    allTools();
    const { transcribe } = await load();
    const input = () => {
      const args = call("/bin/ffmpeg")[1] as string[];
      return path.basename(args[args.indexOf("-i") + 1]!);
    };
    await transcribe(Buffer.from("a"));
    expect(input()).toBe("input.webm");
    vi.clearAllMocks();
    await transcribe(Buffer.from("a"), "../o.gg");
    expect(input()).toBe("input.ogg");
    vi.clearAllMocks();
    await transcribe(Buffer.from("a"), "/./");
    expect(input()).toBe("input.webm");
  });

  it("removes the temp folder when ffmpeg fails", async () => {
    allTools();
    sys.fail = "/bin/ffmpeg";
    const { transcribe } = await load();
    await expect(transcribe(Buffer.from("a"))).rejects.toThrow("/bin/ffmpeg crashed");
    const args = call("/bin/ffmpeg")[1] as string[];
    expect(fs.existsSync(path.dirname(args[args.indexOf("-i") + 1]!))).toBe(false);
    expect(call("/bin/whisper-cli")).toBeUndefined();
  });

  it("uses the warm server when Advanced dictation has one", async () => {
    allTools();
    prefs.value.advanced = true;
    prefs.value.language = "es";
    sys.bins = { ...sys.bins, "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    server.transcribe.mockResolvedValue("from the server");
    const { transcribe } = await load();
    expect(await transcribe(Buffer.from("a"), "webm", "en-US")).toBe("from the server");
    const [bin, m, wav, opts] = server.transcribe.mock.calls[0]!;
    expect(bin).toBe("/bin/whisper-server");
    expect(m).toBe(modelState.file);
    expect(wav).toContain("audio.wav");
    expect(opts).toMatchObject({ language: "es", prompt: "" });
    expect(typeof opts.audioCtx).toBe("number");
    expect(call("/bin/whisper-cli")).toBeUndefined();
  });

  it("falls back to the CLI when the warm server fails", async () => {
    allTools();
    prefs.value.advanced = true;
    sys.bins = { ...sys.bins, "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    server.transcribe.mockRejectedValue(new Error("server died"));
    sys.stdout = "from the cli";
    const { transcribe } = await load();
    expect(await transcribe(Buffer.from("a"))).toBe("from the cli");
    expect(call("/bin/whisper-cli")).toBeDefined();
  });

  it("falls back to the CLI when Advanced dictation has no server or no model", async () => {
    allTools();
    prefs.value.advanced = true;
    sys.stdout = "from the cli";
    const { transcribe } = await load();
    expect(await transcribe(Buffer.from("a"))).toBe("from the cli");
    expect(server.transcribe).not.toHaveBeenCalled();
    expect(call("/bin/whisper-cli")).toBeDefined();
  });

  it("runs whisper again over the full window when the narrow one looped", async () => {
    allTools();
    const { transcribe } = await load();
    // The first pass repeats the same six words; the second answers properly.
    let pass = 0;
    const fake = (bin: string, args: string[], _o: unknown, cb: (e: null, o: unknown) => void) => {
      if (bin.endsWith("ffmpeg")) {
        fs.writeFileSync(args[args.length - 1]!, Buffer.alloc(44 + 32_000 * 2));
        cb(null, { stdout: "" });
        return;
      }
      pass += 1;
      cb(null, { stdout: pass === 1 ? "a b c d e f a b c d e f" : "the real words" });
    };
    vi.mocked(child.execFile).mockImplementation(fake as never);

    expect(await transcribe(Buffer.from("a"))).toBe("the real words");
    const runs = vi.mocked(child.execFile).mock.calls.filter(([b]) => b.endsWith("whisper-cli"));
    expect(runs).toHaveLength(2);
    // The second run has no shortened window.
    expect(runs[1]![1] as string[]).not.toContain("-ac");
  });

  it("does not run whisper twice when the narrow window heard real speech", async () => {
    allTools();
    sys.stdout = "hello there";
    const { transcribe } = await load();
    expect(await transcribe(Buffer.from("a"))).toBe("hello there");
    expect(vi.mocked(child.execFile).mock.calls.filter(([b]) => b.endsWith("whisper-cli"))).toHaveLength(1);
  });

  it("leaves out the shortened window for a long recording", async () => {
    allTools();
    const { transcribe } = await load();
    // A WAV of more than 20 seconds gets the full 30 s window.
    const fake = (bin: string, args: string[], _o: unknown, cb: (e: null, o: unknown) => void) => {
      if (bin.endsWith("ffmpeg")) {
        fs.writeFileSync(args[args.length - 1]!, Buffer.alloc(44 + 32_000 * 21));
        cb(null, { stdout: "" });
        return;
      }
      cb(null, { stdout: "hello there" });
    };
    vi.mocked(child.execFile).mockImplementation(fake as never);

    expect(await transcribe(Buffer.from("a"))).toBe("hello there");
    const args = call("/bin/whisper-cli")[1] as string[];
    expect(args).not.toContain("-ac");
  });
});

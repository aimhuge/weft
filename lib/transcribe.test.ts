import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExecFile, modelState, prefs, server, sys } from "./transcribe.harness";

// whisper.cpp, ffmpeg and `which` are all mocked: execFileSync answers `which`, execFile plays
// ffmpeg and whisper-cli. Nothing is ever transcribed for real. The dictation settings, the
// advanced model's state and the warm server are mocked too, so no file is read and no port opened.
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
  modelState.download = { downloading: false, received: 0, total: 0 };
  server.transcribe.mockReset();
  server.warm.mockReset();
  server.transcribe.mockResolvedValue("from the server");
  server.warm.mockResolvedValue({});
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.WEFT_WHISPER_MODEL;
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dictationStatus", () => {
  it("is available with whisper, ffmpeg and a model, naming the model", async () => {
    allTools();
    const { dictationStatus } = await load();
    expect(dictationStatus()).toEqual({ available: true, reason: undefined, model: "ggml-test.bin" });
  });

  it("asks for whisper.cpp first", async () => {
    sys.bins = { ffmpeg: "/bin/ffmpeg" };
    const { dictationStatus } = await load();
    expect(dictationStatus()).toEqual({
      available: false,
      reason: "Dictation needs whisper.cpp: brew install whisper-cpp",
      model: undefined,
    });
  });

  it("treats an empty `which` answer as missing", async () => {
    sys.bins = { "whisper-cli": "", ffmpeg: "/bin/ffmpeg" };
    const { dictationStatus } = await load();
    expect(dictationStatus().reason).toMatch(/whisper\.cpp/);
  });

  it("then asks for ffmpeg", async () => {
    sys.bins = { "whisper-cli": "/bin/whisper-cli" };
    const { dictationStatus } = await load();
    expect(dictationStatus()).toMatchObject({ available: false, reason: "Dictation needs ffmpeg: brew install ffmpeg" });
  });

  it("then asks for a model when none of the known paths exist", async () => {
    allTools();
    delete process.env.WEFT_WHISPER_MODEL;
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const { dictationStatus } = await load();
    expect(dictationStatus()).toMatchObject({
      available: false,
      reason: "Dictation needs a whisper model, e.g. ggml-base.en.bin in /opt/homebrew/share/whisper-cpp",
    });
  });

  it("finds a superwhisper model in the home folder", async () => {
    allTools();
    delete process.env.WEFT_WHISPER_MODEL;
    const exists = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith("superwhisper/ggml-small.bin") || exists(p));
    const { dictationStatus } = await load();
    expect(dictationStatus().model).toBe("ggml-small.bin");
  });

  it("looks the tools up at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { dictationStatus } = await load();
    expect(dictationStatus().available).toBe(false);
    allTools();
    vi.advanceTimersByTime(59_000);
    expect(dictationStatus().available).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(dictationStatus().available).toBe(true);
    expect(child.execFileSync).toHaveBeenCalledTimes(4); // two lookups of two tools
  });
});

describe("advancedStatus", () => {
  it("reports no server and no model when whisper-server isn't installed", async () => {
    const { advancedStatus } = await load();
    expect(advancedStatus()).toEqual({ server: false, model: undefined, download: { downloading: false, received: 0, total: 0 } });
  });

  it("reports the server and the model it would keep loaded", async () => {
    sys.bins = { "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    const { advancedStatus } = await load();
    expect(advancedStatus()).toMatchObject({ server: true, model: "ggml-large-v3-turbo.bin" });
  });

  it("passes the download's state through", async () => {
    modelState.download = { downloading: true, received: 1024, total: 2048 };
    const { advancedStatus } = await load();
    expect(advancedStatus().download).toEqual({ downloading: true, received: 1024, total: 2048 });
  });
});

describe("warmIfAdvanced", () => {
  it("does nothing when Advanced dictation is off", async () => {
    sys.bins = { "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    const { warmIfAdvanced } = await load();
    warmIfAdvanced();
    expect(server.warm).not.toHaveBeenCalled();
  });

  it("does nothing when whisper-server isn't installed", async () => {
    prefs.value.advanced = true;
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    const { warmIfAdvanced } = await load();
    warmIfAdvanced();
    expect(server.warm).not.toHaveBeenCalled();
  });

  it("does nothing when there is no model to load", async () => {
    prefs.value.advanced = true;
    sys.bins = { "whisper-server": "/bin/whisper-server" };
    const { warmIfAdvanced } = await load();
    warmIfAdvanced();
    expect(server.warm).not.toHaveBeenCalled();
  });

  it("warms the server when Advanced dictation has one", async () => {
    prefs.value.advanced = true;
    sys.bins = { "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    const { warmIfAdvanced } = await load();
    warmIfAdvanced();
    expect(server.warm).toHaveBeenCalledWith("/bin/whisper-server", modelState.file);
  });

  it("swallows a server that won't start", async () => {
    prefs.value.advanced = true;
    sys.bins = { "whisper-server": "/bin/whisper-server" };
    modelState.file = path.join(dir, "ggml-large-v3-turbo.bin");
    server.warm.mockRejectedValue(new Error("no port"));
    const { warmIfAdvanced } = await load();
    expect(() => warmIfAdvanced()).not.toThrow();
  });
});

describe("wavSeconds and audioCtx", () => {
  it("counts the seconds of speech in a 16 kHz WAV", async () => {
    const { wavSeconds } = await load();
    const wav = path.join(dir, "a.wav");
    fs.writeFileSync(wav, Buffer.alloc(44 + 32_000)); // one second
    expect(wavSeconds(wav)).toBe(1);
  });

  it("never goes below zero for a WAV with no audio in it", async () => {
    const { wavSeconds } = await load();
    const wav = path.join(dir, "empty.wav");
    fs.writeFileSync(wav, Buffer.alloc(10));
    expect(wavSeconds(wav)).toBe(0);
  });

  it("gives a long recording the full window and a short one a narrow one", async () => {
    const { audioCtx } = await load();
    expect(audioCtx(0)).toBe(384);
    expect(audioCtx(5)).toBe(448);
    expect(audioCtx(20)).toBe(1152);
    expect(audioCtx(21)).toBe(0);
  });
});

describe("looksBroken", () => {
  it("calls empty text broken", async () => {
    const { looksBroken } = await load();
    expect(looksBroken("")).toBe(true);
    expect(looksBroken("   ")).toBe(true);
    expect(looksBroken("!!! ???")).toBe(true);
  });

  it("calls ordinary speech fine", async () => {
    const { looksBroken } = await load();
    expect(looksBroken("hello there, this is a normal sentence")).toBe(false);
  });

  it("calls the same six words twice broken", async () => {
    const { looksBroken } = await load();
    expect(looksBroken("one two three four five six one two three four five six")).toBe(true);
  });

  it("calls a repeated run of six words broken however long the text is", async () => {
    const { looksBroken } = await load();
    expect(looksBroken("a b c d e f g a b c d e f g")).toBe(true);
  });

  it("calls text whose six-word runs differ fine", async () => {
    const { looksBroken } = await load();
    expect(looksBroken("a b c d e f g h i j k l m n o p")).toBe(false);
  });
});

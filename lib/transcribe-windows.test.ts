import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExecFile, sys } from "./transcribe.harness";

// Dictation on Windows: whisper.cpp ships with Weft and is found on PATH by a PATHEXT walk, there's no ffmpeg
// (the board sends 16 kHz WAV), and what's missing is said in Windows' terms. The fakes are lib/transcribe.harness.ts.

vi.mock("./win-command", () => ({ isWindows: () => true, findOnWindowsPath: (bin: string) => sys.bins[bin] ?? null }));

let dir: string;
let child: typeof import("node:child_process");

async function load() {
  vi.resetModules();
  child = await import("node:child_process");
  vi.mocked(child.execFile).mockImplementation(defaultExecFile as never);
  return import("./transcribe");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dictation-win-"));
  const model = path.join(dir, "ggml-test.bin");
  fs.writeFileSync(model, "");
  process.env.WEFT_WHISPER_MODEL = model;
  sys.bins = { "whisper-cli": "C:\\Weft\\resources\\toolchain\\whisper\\whisper-cli.exe" };
  sys.stdout = "hello from windows";
  sys.fail = null;
});
afterEach(() => {
  delete process.env.WEFT_WHISPER_MODEL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dictation on Windows", () => {
  it("is available with the bundled whisper and a model, and no ffmpeg", async () => {
    const { dictationStatus } = await load();
    expect(dictationStatus()).toEqual({ available: true, reason: undefined, model: "ggml-test.bin" });
  });

  it("hands the board's WAV to whisper as it is, without ffmpeg", async () => {
    const { transcribe } = await load();
    const wav = Buffer.alloc(44 + 32_000 * 2);
    await expect(transcribe(wav, "wav", "en-US")).resolves.toBe("hello from windows");
    const bins = vi.mocked(child.execFile).mock.calls.map(([bin]) => bin);
    expect(bins).toEqual(["C:\\Weft\\resources\\toolchain\\whisper\\whisper-cli.exe"]);
  });

  it("can't read a webm recording without ffmpeg, and says so", async () => {
    const { transcribe } = await load();
    await expect(transcribe(Buffer.from("webm"), "webm")).rejects.toThrow("Dictation needs ffmpeg to read a webm recording");
  });

  it("says to reinstall Weft when whisper is missing", async () => {
    sys.bins = {};
    const { dictationStatus } = await load();
    expect(dictationStatus().reason).toBe("Dictation needs whisper.cpp, which comes with Weft: reinstall Weft to get it back");
  });

  it("points at Settings → Dictation for the model", async () => {
    delete process.env.WEFT_WHISPER_MODEL;
    const { dictationStatus } = await load();
    expect(dictationStatus().reason).toBe("Dictation needs a whisper model: turn on Advanced in Settings → Dictation to download one");
  });
});

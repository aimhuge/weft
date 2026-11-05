// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { flush, getUserMedia, installFakes, loadHook, recorder } from "./dictation.harness";

// Dictation on a Windows board: the recording goes to whisper as WAV (no ffmpeg there), and the mic hint names
// Windows' own Settings. lib/wav-encode.ts is faked; lib/wav-encode.test.ts covers it.

const api = vi.hoisted(() => ({ dictation: vi.fn(), transcribe: vi.fn() }));
vi.mock("./client", () => ({ api }));
const wav = vi.hoisted(() => new Blob(["RIFF"], { type: "audio/wav" }));
vi.mock("./wav-encode", () => ({ sendsWav: () => true, toWhisperWav: vi.fn(() => Promise.resolve(wav)) }));

installFakes(api);

async function startRecording() {
  const useDictation = await loadHook();
  const hook = renderHook(() => useDictation(vi.fn()));
  act(() => hook.result.current.toggle());
  await flush();
  return hook;
}

describe("useDictation on Windows", () => {
  it("sends whisper a WAV instead of the recorder's webm", async () => {
    const { result } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(api.transcribe.mock.calls[0]![0]).toBe(wav);
  });

  it("points a denied mic at Windows' Settings", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { result } = await startRecording();
    expect(result.current.error).toBe("Weft can't use the microphone. Allow it in Settings → Privacy & security → Microphone.");
  });
});

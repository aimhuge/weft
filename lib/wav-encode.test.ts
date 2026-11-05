import { describe, expect, it, vi } from "vitest";
import { WHISPER_RATE, encodeWav, sendsWav, toWhisperWav } from "./wav-encode";

// The WAV Windows' dictation sends whisper.cpp: 16 kHz mono 16-bit, built in the board with no ffmpeg.

const ascii = (view: DataView, at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)));

describe("encodeWav", () => {
  it("writes a 44-byte PCM header and 16-bit little-endian samples", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5])));
    expect(view.byteLength).toBe(44 + 12);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 12);
    expect(ascii(view, 8, 8)).toBe("WAVEfmt ");
    expect([view.getUint32(16, true), view.getUint16(20, true), view.getUint16(22, true)]).toEqual([16, 1, 1]);
    expect([view.getUint32(24, true), view.getUint32(28, true), view.getUint16(32, true), view.getUint16(34, true)]).toEqual([16_000, 32_000, 2, 16]);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(12);
    // Out-of-range samples are clipped to the 16-bit range.
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
  });

  it("takes another rate", () => {
    expect(new DataView(encodeWav(new Float32Array(0), 8000)).getUint32(24, true)).toBe(8000);
  });
});

describe("toWhisperWav", () => {
  it("decodes the recording and renders it at 16 kHz mono", async () => {
    const decoded = { duration: 0.5 };
    const source = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
    const contexts: { channels: number; length: number; rate: number }[] = [];
    class FakeContext {
      destination = {};
      constructor(channels: number, length: number, rate: number) {
        contexts.push({ channels, length, rate });
      }
      decodeAudioData = vi.fn(() => Promise.resolve(decoded));
      createBufferSource = () => source;
      startRendering = () => Promise.resolve({ getChannelData: () => new Float32Array(8000) });
    }
    const wav = await toWhisperWav(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), FakeContext as never);
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 16_000);
    expect(contexts).toEqual([
      { channels: 1, length: 1, rate: WHISPER_RATE },
      { channels: 1, length: 8000, rate: WHISPER_RATE },
    ]);
    expect(source.buffer).toBe(decoded);
    expect(source.start).toHaveBeenCalled();
  });

  it("uses the browser's OfflineAudioContext by default", async () => {
    const stub = vi.fn(function (this: Record<string, unknown>) {
      this.decodeAudioData = () => Promise.resolve({ duration: 0 });
      this.createBufferSource = () => ({ connect() {}, start() {} });
      this.startRendering = () => Promise.resolve({ getChannelData: () => new Float32Array(1) });
    });
    vi.stubGlobal("OfflineAudioContext", stub);
    try {
      expect((await toWhisperWav(new Blob([]))).size).toBe(46);
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("sendsWav", () => {
  it("is true on Windows only", () => {
    expect(sendsWav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Weft/0.7.5 Electron/44")).toBe(true);
    expect(sendsWav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/44")).toBe(false);
  });

  it("reads navigator.userAgent by default", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows" });
    try {
      expect(sendsWav()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

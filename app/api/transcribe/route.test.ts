import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/transcribe", () => ({
  dictationStatus: vi.fn(() => ({ available: true, model: "ggml-base.en.bin" })),
  transcribe: vi.fn(() => Promise.resolve("hello world")),
  warmIfAdvanced: vi.fn(),
}));

const { dictationStatus, transcribe, warmIfAdvanced } = await import("@/lib/transcribe");
const URL_BASE = "http://localhost/api/transcribe";
const WRITE = { host: "localhost", "x-weft-token": "1" };

const post = (body: BodyInit | null, headers: Record<string, string> = {}, query = "") =>
  POST(new Request(`${URL_BASE}${query}`, { method: "POST", body, headers: { ...WRITE, ...headers } }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/transcribe", () => {
  it("returns whether dictation can run", async () => {
    const res = await GET(new Request(URL_BASE, { headers: { host: "localhost" } }));
    expect(await res.json()).toEqual({ available: true, model: "ggml-base.en.bin" });
    expect(dictationStatus).toHaveBeenCalled();
  });

  it("warms the server for Advanced dictation as the mic opens", async () => {
    await GET(new Request(URL_BASE, { headers: { host: "localhost" } }));
    expect(warmIfAdvanced).toHaveBeenCalled();
  });

  it("refuses a foreign host", async () => {
    const res = await GET(new Request(URL_BASE, { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
    expect(dictationStatus).not.toHaveBeenCalled();
    expect(warmIfAdvanced).not.toHaveBeenCalled();
  });
});

describe("POST /api/transcribe", () => {
  it("transcribes the recording and returns its text", async () => {
    const res = await post("audio", { "content-type": "audio/webm;codecs=opus" });
    expect(await res.json()).toEqual({ text: "hello world" });
    expect(transcribe).toHaveBeenCalledWith(Buffer.from("audio"), "webm", null);
  });

  it("passes the board's language on to whisper", async () => {
    await post("audio", {}, "?lang=en-US");
    expect(transcribe).toHaveBeenCalledWith(Buffer.from("audio"), "webm", "en-US");
  });

  it.each([
    ["audio/mp4", "m4a"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/wav", "wav"],
    ["", "webm"],
  ])("picks the file extension from content type %j", async (type, ext) => {
    // A Blob body with no type sends no content-type at all.
    await post(new Blob(["audio"]), type ? { "content-type": type } : {});
    expect(vi.mocked(transcribe).mock.calls[0]![1]).toBe(ext);
  });

  it("is a 400 when nothing was recorded", async () => {
    const res = await post(null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing was recorded." });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("is a 400 with the reason when transcription fails", async () => {
    vi.mocked(transcribe).mockRejectedValueOnce(new Error("Dictation needs ffmpeg: brew install ffmpeg"));
    const res = await post("audio");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dictation needs ffmpeg: brew install ffmpeg" });
  });

  it("refuses a request without the write header", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "audio", headers: { host: "localhost" } }));
    expect(res.status).toBe(403);
    expect(transcribe).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, UPLOAD_REPLY_MS, type UploadedAttachment } from "./client-api";
import { fetchMock } from "./client-api.harness";

// The two parts of the fetch client that aren't plain fetch calls: the attachment upload (XHR, so
// it can report progress) and the theme-from-picture and transcribe helpers (multipart and a raw
// body). The fake fetch and the helpers that read it live in lib/client-api.harness.ts.

// A stand-in for XMLHttpRequest: a test drives it through the same events the browser fires.
class FakeXhr {
  static last: FakeXhr | null = null;
  status = 200;
  responseText = "{}";
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null, onload: null as (() => void) | null };
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  body: unknown = null;
  abort = vi.fn();

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  // The events the browser fires when the reply is in.
  finish() {
    this.upload.onload?.();
    this.onload?.();
    this.onloadend?.();
  }
}

beforeEach(() => {
  FakeXhr.last = null;
  vi.stubGlobal("XMLHttpRequest", function () {
    FakeXhr.last = new FakeXhr();
    return FakeXhr.last;
  });
});

const xhr = () => {
  if (!FakeXhr.last) throw new Error("no request was made");
  return FakeXhr.last;
};

describe("the attachment upload", () => {
  it("posts the file and resolves with what the server kept", async () => {
    const done = api.uploadAttachment(new Blob(["bytes"], { type: "image/png" }), "shot.png");
    const x = xhr();
    expect(x.method).toBe("POST");
    expect(x.url).toBe("/api/attachments");
    expect(x.headers).toMatchObject({ "x-weft-token": "1", "x-filename": "shot.png", "content-type": "image/png" });
    x.responseText = JSON.stringify({ name: "shot.png", path: "/tmp/shot.png", url: "/api/files/shot.png", kind: "image", bytes: 5 });
    x.finish();
    await expect(done).resolves.toEqual({ name: "shot.png", path: "/tmp/shot.png", url: "/api/files/shot.png", kind: "image", bytes: 5 });
  });

  it("falls back to a generic content type for a file without one", () => {
    void api.uploadAttachment(new Blob(["bytes"]), "notes.bin");
    expect(xhr().headers["content-type"]).toBe("application/octet-stream");
  });

  it("reports the progress of the upload", () => {
    const seen: number[] = [];
    void api.uploadAttachment(new Blob(["bytes"]), "shot.png", (f) => seen.push(f));
    const x = xhr();
    x.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
    expect(seen).toEqual([0.5]);
  });

  it("ignores a progress event that doesn't know its length", () => {
    const seen: number[] = [];
    void api.uploadAttachment(new Blob(["bytes"]), "shot.png", (f) => seen.push(f));
    xhr().upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 } as ProgressEvent);
    expect(seen).toEqual([]);
  });

  it("rejects with the server's error", async () => {
    const done = api.uploadAttachment(new Blob(["bytes"]), "shot.png");
    const x = xhr();
    x.status = 413;
    x.responseText = JSON.stringify({ error: "Too big." });
    x.finish();
    await expect(done).rejects.toThrow("Too big.");
  });

  it("rejects with the status when the server says nothing", async () => {
    const done = api.uploadAttachment(new Blob(["bytes"]), "shot.png");
    const x = xhr();
    x.status = 500;
    x.responseText = "not json";
    x.finish();
    await expect(done).rejects.toThrow("Upload failed (500).");
  });

  it("rejects when the reply is a success with no file in it", async () => {
    const done = api.uploadAttachment(new Blob(["bytes"]), "shot.png");
    const x = xhr();
    x.responseText = JSON.stringify({ name: "shot.png" });
    x.finish();
    await expect(done).rejects.toThrow("Upload failed (200).");
  });

  it("rejects when the request itself fails", async () => {
    const done = api.uploadAttachment(new Blob(["bytes"]), "shot.png");
    const x = xhr();
    x.onerror?.();
    await expect(done).rejects.toThrow("Upload failed.");
  });

  it("gives up on a server that never answers", async () => {
    vi.useFakeTimers();
    try {
      const done = api.uploadAttachment(new Blob(["bytes"]), "shot.png");
      const x = xhr();
      // The bytes are all sent, and nothing comes back.
      x.upload.onload?.();
      vi.advanceTimersByTime(UPLOAD_REPLY_MS);
      await expect(done).rejects.toThrow("Weft's server didn't answer in a minute.");
      expect(x.abort).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the theme from a picture", () => {
  it("posts the picture and the words as multipart", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "neon", card: { id: "c1" } }), { status: 200 })));
    const picture = new File([new Uint8Array([1, 2, 3])], "beach.jpg", { type: "image/jpeg" });
    const answer = await api.themeFromPicture("warm", picture);
    expect(answer).toEqual({ id: "neon", card: { id: "c1" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/themes");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-weft-token": "1" });
    const form = init?.body as FormData;
    expect(form.get("prompt")).toBe("warm");
    expect(form.get("picture")).toBe(picture);
  });

  it("turns a failed reply into the server's error", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "Describe the theme you want." }), { status: 400 })));
    const picture = new File([new Uint8Array([1])], "beach.jpg", { type: "image/jpeg" });
    await expect(api.themeFromPicture("warm", picture)).rejects.toThrow("Describe the theme you want.");
  });
});

describe("the audio transcribe", () => {
  it("posts the audio and answers with the text", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ text: "hello" }), { status: 200 })));
    const audio = new Blob(["sound"], { type: "audio/webm" });
    const answer = await api.transcribe(audio);
    expect(answer).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/transcribe");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-weft-token": "1", "content-type": "audio/webm" });
    expect(init?.body).toBe(audio);
  });

  it("falls back to the webm type for audio without one", async () => {
    await api.transcribe(new Blob(["sound"]));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "content-type": "audio/webm" });
  });

  it("answers with no text when the server heard none", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    expect(await api.transcribe(new Blob(["sound"]))).toBe("");
  });
});

describe("the attachment types", () => {
  it("names what an upload answers with", () => {
    const attachment: UploadedAttachment = { name: "a", path: "/b", url: "/c", kind: "image", bytes: 1 };
    expect(attachment.kind).toBe("image");
  });
});

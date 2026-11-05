import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The model on disk and its download. Nothing is fetched for real: the fake fetch answers with a
// web stream, and the write stream is a sink that only counts bytes, so a 100 MB "model" costs nothing.
// os.homedir() points at a temp dir and fs.existsSync is answered by hand, so the Superwhisper and
// Homebrew models on this Mac never leak into the test.

let dir: string;
let home: string;
let exists: (p: string) => boolean;
let written: number;
const g = globalThis as unknown as { weftWhisperModelDownload?: unknown };

// 100 MB in 10 MB chunks: the smallest size the code accepts as a model.
const CHUNK = 10 * 1024 * 1024;
const CHUNKS = 10;

function body(chunks = CHUNKS, size = CHUNK) {
  const buffer = Buffer.alloc(size, 1);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(buffer);
    },
  });
}

function response(opts: { ok?: boolean; status?: number; length?: number | null; chunks?: number; size?: number }) {
  const headers = new Headers();
  if (opts.length !== null) headers.set("content-length", String(opts.length ?? opts.chunks ?? CHUNKS * (opts.size ?? CHUNK)));
  return new Response(body(opts.chunks, opts.size) as unknown as BodyInit, { status: opts.status ?? 200, headers });
}

async function load() {
  vi.resetModules();
  delete g.weftWhisperModelDownload;
  return import("./whisper-model");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-whisper-model-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-whisper-home-"));
  process.env.WEFT_DATA = dir;
  exists = () => false;
  written = 0;

  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    const path = String(p);
    // Only the model paths are answered by hand; everything else (the temp dirs) is real.
    if (path.includes("ggml-large-v3-turbo") || path.includes("whisper-cpp")) return exists(path);
    return false;
  });
  vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
  vi.spyOn(fs, "rmSync").mockImplementation(() => undefined);
  vi.spyOn(fs, "renameSync").mockImplementation(() => undefined);
  vi.spyOn(fs, "createWriteStream").mockImplementation(() => {
    return new Writable({
      write(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        cb();
      },
    }) as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete g.weftWhisperModelDownload;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("serverModel", () => {
  it("finds nothing when no candidate is on disk", async () => {
    const { serverModel } = await load();
    expect(serverModel()).toBeUndefined();
  });

  it("finds the model Weft downloaded", async () => {
    const { MODEL_FILE, serverModel } = await load();
    exists = (p) => p === MODEL_FILE;
    expect(serverModel()).toBe(MODEL_FILE);
  });

  it("finds Superwhisper's model in the home folder", async () => {
    const { serverModel } = await load();
    exists = (p) => p.includes("superwhisper");
    expect(serverModel()).toBe(path.join(home, "Library/Application Support/superwhisper/ggml-large-v3-turbo.bin"));
  });

  it("finds Homebrew's model", async () => {
    const { serverModel } = await load();
    exists = (p) => p.startsWith("/opt/homebrew");
    expect(serverModel()).toBe("/opt/homebrew/share/whisper-cpp/ggml-large-v3-turbo.bin");
  });

  it("prefers Weft's own copy", async () => {
    const { MODEL_FILE, serverModel } = await load();
    exists = () => true;
    expect(serverModel()).toBe(MODEL_FILE);
  });
});

describe("downloadState", () => {
  it("starts idle", async () => {
    const { downloadState } = await load();
    expect(downloadState()).toEqual({ downloading: false, received: 0, total: 0 });
  });

  it("gives a copy, so the caller can't change it", async () => {
    const { downloadState } = await load();
    const state = downloadState();
    state.downloading = true;
    expect(downloadState().downloading).toBe(false);
  });
});

describe("downloadModel", () => {
  it("downloads the model and renames it into place", async () => {
    const { MODEL_FILE, MODEL_URL, downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(response({ length: CHUNKS * CHUNK }));

    await downloadModel(fetchImpl as never);

    expect(fetchImpl).toHaveBeenCalledWith(MODEL_URL);
    expect(written).toBe(CHUNKS * CHUNK);
    expect(fs.renameSync).toHaveBeenCalledWith(`${MODEL_FILE}.part`, MODEL_FILE);
    expect(downloadState()).toEqual({ downloading: false, received: CHUNKS * CHUNK, total: CHUNKS * CHUNK, error: undefined });
  });

  it("doesn't fetch when the model is already here", async () => {
    const { MODEL_FILE, downloadModel } = await load();
    exists = (p) => p === MODEL_FILE;
    const fetchImpl = vi.fn();

    await downloadModel(fetchImpl as never);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns early when a download is already running", async () => {
    const { downloadModel } = await load();
    let release: (() => void) | undefined;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(response({ length: CHUNKS * CHUNK }));
        }),
    );

    const first = downloadModel(fetchImpl as never);
    const second = downloadModel(fetchImpl as never);
    release?.();
    await Promise.all([first, second]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports an HTTP failure", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("The model download failed (HTTP 404).");
    expect(downloadState().downloading).toBe(false);
    expect(fs.rmSync).toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it("reports a body that isn't there", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("The model download failed (HTTP 200).");
  });

  it("turns down a download that is too small to be a model", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(response({ length: 1024, chunks: 1, size: 1024 }));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("The model download was cut off. Try again.");
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it("turns down a download that stops early", async () => {
    const { downloadModel, downloadState } = await load();
    // The server promises 100 MB but sends one chunk.
    const fetchImpl = vi.fn().mockResolvedValue(response({ length: CHUNKS * CHUNK, chunks: 1 }));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("The model download was cut off. Try again.");
    expect(downloadState().received).toBe(CHUNK);
    expect(downloadState().total).toBe(CHUNKS * CHUNK);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it("takes a download without a content-length at its word", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockResolvedValue(response({ length: null }));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBeUndefined();
    expect(downloadState().total).toBe(0);
    expect(fs.renameSync).toHaveBeenCalled();
  });

  it("reports a fetch that fails", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("the network is down"));

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("the network is down");
    expect(downloadState().downloading).toBe(false);
  });

  it("reports a failure that isn't an Error", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockRejectedValue("just a string");

    await downloadModel(fetchImpl as never);

    expect(downloadState().error).toBe("just a string");
  });

  it("removes the half-written file when the download fails", async () => {
    const { MODEL_FILE, downloadModel } = await load();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));

    await downloadModel(fetchImpl as never);

    expect(fs.rmSync).toHaveBeenCalledWith(`${MODEL_FILE}.part`, { force: true });
  });

  it("tries again after a failure", async () => {
    const { downloadModel, downloadState } = await load();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(response({ length: CHUNKS * CHUNK }));

    await downloadModel(fetchImpl as never);
    expect(downloadState().error).toBe("boom");

    await downloadModel(fetchImpl as never);
    expect(downloadState().error).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

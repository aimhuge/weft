import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DownloadState } from "./dictation-types";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";

// The model Advanced dictation keeps loaded (lib/whisper-server.ts): large-v3-turbo, the best of
// whisper's fast models. One already on this Mac (Superwhisper's, Homebrew's) is used as is; otherwise
// Weft downloads the 5-bit copy (~550 MB, close to the full one's accuracy) once into ~/.weft/models.

export const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
export const MODEL_FILE = path.join(DATA_DIR, "models", "ggml-large-v3-turbo-q5_0.bin");

// Anything smaller is an error page or a cut-off download, not a model.
const MIN_BYTES = 100 * 1024 * 1024;

function candidates() {
  return [
    MODEL_FILE,
    path.join(os.homedir(), "Library/Application Support/superwhisper/ggml-large-v3-turbo.bin"),
    "/opt/homebrew/share/whisper-cpp/ggml-large-v3-turbo.bin",
  ];
}

// The turbo model on disk, if there is one.
export function serverModel(): string | undefined {
  return candidates().find((m) => fs.existsSync(m));
}

export type { DownloadState };

const state = globalSingleton<DownloadState>("weftWhisperModelDownload", () => ({ downloading: false, received: 0, total: 0 }));

export function downloadState(): DownloadState {
  return { ...state };
}

// Fetches the model unless it's here or on its way; resolves when it's done. Errors land in the state.
export async function downloadModel(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (serverModel() || state.downloading) return;
  Object.assign(state, { downloading: true, received: 0, total: 0, error: undefined });
  const part = `${MODEL_FILE}.part`;
  try {
    fs.mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
    const res = await fetchImpl(MODEL_URL);
    if (!res.ok || !res.body) throw new Error(`The model download failed (HTTP ${res.status}).`);
    state.total = Number(res.headers.get("content-length")) || 0;
    const count = async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        state.received += chunk.length;
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, fs.createWriteStream(part));
    if (state.received < MIN_BYTES || (state.total && state.received !== state.total)) {
      throw new Error("The model download was cut off. Try again.");
    }
    fs.renameSync(part, MODEL_FILE);
  } catch (err) {
    fs.rmSync(part, { force: true });
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.downloading = false;
  }
}

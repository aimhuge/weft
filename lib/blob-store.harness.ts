import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { BLOB_BUCKET } from "./cloud-sync-types";
import { createBlobStore } from "./blob-store";

// A fake Supabase client whose storage.from(bucket).upload/download returns whatever the test
// queued next, so each test pushes one entry per expected call and inspects the recorded calls.
// The union shape matches the real storage-js types so the linter's narrowing is honest.
type UploadResult = { data?: { id: string; path: string; fullPath: string } | null; error: { name?: string; statusCode?: string; message?: string } | null };
type DownloadResult = { data: Blob | Uint8Array | null; error: { message: string } | null };
export function makeClient() {
  const uploadCalls: Array<{ path: string; body: Buffer; opts: { contentType?: string; upsert?: boolean } }> = [];
  const downloadCalls: string[] = [];
  const uploads: UploadResult[] = [];
  const downloads: DownloadResult[] = [];
  const from = vi.fn((bucket: string) => {
    if (bucket !== BLOB_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
    return {
      upload: (p: string, body: Buffer, opts: { contentType?: string; upsert?: boolean }) => {
        uploadCalls.push({ path: p, body, opts });
        return Promise.resolve(uploads.shift() ?? { data: { id: "x", path: p, fullPath: p }, error: null });
      },
      download: (p: string) => {
        downloadCalls.push(p);
        return Promise.resolve(downloads.shift() ?? { data: null, error: { message: "no data" } });
      },
    };
  });
  return { client: { storage: { from } } as never, uploadCalls, downloadCalls, uploads, downloads, from };
}

export const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "weft-blob-home-"));
export const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-blob-data-"));

export const file = (name: string, bytes: Buffer | string = "hello") => {
  const p = path.join(HOME, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
};
export const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const cacheDir = () => path.join(DATA, "blob-cache");
export const store = (m: ReturnType<typeof makeClient>) => createBlobStore({ client: m.client, cacheDir: cacheDir() });

// Points HOME and WEFT_DATA at empty folders for each test of the file that calls it.
export function withBlobDirs() {
  let envHome = "";
  let envData = "";
  beforeEach(() => {
    envHome = process.env.HOME ?? "";
    envData = process.env.WEFT_DATA ?? "";
    process.env.HOME = HOME;
    process.env.WEFT_DATA = DATA;
    fs.rmSync(DATA, { recursive: true, force: true });
    fs.rmSync(HOME, { recursive: true, force: true });
    fs.mkdirSync(HOME, { recursive: true });
    fs.mkdirSync(DATA, { recursive: true });
  });
  afterEach(() => {
    process.env.HOME = envHome;
    process.env.WEFT_DATA = envData;
  });
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BLOB_BUCKET } from "./cloud-sync-types";
import { workerBlobClient, workerMayUpload } from "./worker-blobs";

// A worker's home laid out as a real one: the secrets beside the folders pages come from.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "worker-home-")));
const worker = path.join(home, ".weft-worker");
const show = path.join(worker, "data", "show");
const work = path.join(worker, "work");
const roots = [show, work];
const put = (rel: string, text = "x") => {
  const file = path.join(worker, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const may = (file: string, r = roots) => workerMayUpload(file, r, home);

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("workerMayUpload", () => {
  it("takes web files from the show folder and the checkouts", () => {
    expect(may(put("data/show/plan.html"))).toBe(true);
    expect(may(put("data/show/deep/shot.png"))).toBe(true);
    expect(may(put("work/ling/docs/site.css"))).toBe(true);
  });

  it.each(["worker.json", "worker.env", "seal-key.json", "github-credentials", "data/board.json", "data/threads/a.json"])("refuses %s, outside both roots", (rel) => {
    expect(may(put(rel))).toBe(false);
  });

  it("refuses a dot folder or a dot file in a checkout", () => {
    expect(may(put("work/ling/.git/page.html"))).toBe(false);
    expect(may(put("work/ling/.secrets/a.png"))).toBe(false);
    expect(may(put("work/ling/.hidden.html"))).toBe(false);
  });

  it("refuses what isn't a web file, and a token by name", () => {
    expect(may(put("work/ling/config.json"))).toBe(false);
    expect(may(put("work/ling/deploy.pem"))).toBe(false);
    expect(may(put("work/ling/.env.html"))).toBe(false);
    expect(may(put("work/ling/gh-token.html"))).toBe(true); // Only the exact -token suffix is a secret by name.
    expect(may(put("work/ling/gh-token"))).toBe(false);
  });

  it("follows a symlink to where it lands", () => {
    const key = put("worker.json");
    const link = path.join(show, "innocent.html");
    fs.symlinkSync(key, link);
    expect(may(link)).toBe(false);
    const fine = path.join(show, "alias.html");
    fs.symlinkSync(put("data/show/real.html"), fine);
    expect(may(fine)).toBe(true);
  });

  it("refuses a missing file, a missing root and the root itself", () => {
    expect(may(path.join(show, "gone.html"))).toBe(false);
    expect(may(put("data/show/a.html"), [path.join(worker, "nowhere")])).toBe(false);
    expect(workerMayUpload(put("data/show/a.html"), roots, path.join(home, "nobody"))).toBe(false);
    expect(may(show)).toBe(false);
  });
});

function client(answer: { status?: number; body?: unknown; bad?: boolean }, signed: { error: { message: string } | null } = { error: null }) {
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve({ ok: (answer.status ?? 200) < 300, status: answer.status ?? 200, json: () => (answer.bad ? Promise.reject(new Error("no json")) : Promise.resolve(answer.body)) } as Response),
  );
  const uploadToSignedUrl = vi.fn(() => Promise.resolve(signed));
  const from = vi.fn(() => ({ uploadToSignedUrl }));
  const made = workerBlobClient("wwk_key", { from }, "https://weft.test", fetcher as unknown as typeof fetch);
  return { bucket: made.storage.from(BLOB_BUCKET), fetcher, uploadToSignedUrl, from };
}

const bytes = Buffer.from("<html>");

describe("workerBlobClient", () => {
  it("asks the route with its key, then uploads to the path the route names", async () => {
    const { bucket, fetcher, uploadToSignedUrl, from } = client({ body: { path: "real-org/abc", token: "t" } });
    expect(await bucket.upload("whatever/abc", bytes, { contentType: "text/html" })).toEqual({ error: null });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://weft.test/api/worker-blob");
    expect(init?.headers).toMatchObject({ authorization: "Bearer wwk_key" });
    expect(init?.body).toBe(JSON.stringify({ sha: "abc" }));
    expect(from).toHaveBeenCalledWith(BLOB_BUCKET);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("real-org/abc", "t", bytes, { contentType: "text/html" });
  });

  it("counts a blob that's already there as uploaded", async () => {
    const { bucket, uploadToSignedUrl } = client({ body: { exists: true } });
    expect(await bucket.upload("o/abc", bytes)).toEqual({ error: null });
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("hands back the route's refusal, and a status when it says nothing", async () => {
    expect(await client({ status: 401, body: { error: "That key isn't a worker's." } }).bucket.upload("o/abc", bytes)).toEqual({ error: { message: "That key isn't a worker's." } });
    expect(await client({ status: 500, bad: true }).bucket.upload("o/abc", bytes)).toEqual({ error: { message: "worker-blob: HTTP 500" } });
  });

  it("passes the storage error on, so the blob store can read 'already exists'", async () => {
    const { bucket } = client({ body: { path: "o/abc", token: "t" } }, { error: { message: "The resource already exists" } });
    expect(await bucket.upload("o/abc", bytes)).toEqual({ error: { message: "The resource already exists" } });
  });

  it("doesn't read blobs back", async () => {
    expect(await client({}).bucket.download("o/abc")).toEqual({ data: null, error: { message: "A worker doesn't read blobs." } });
  });
});

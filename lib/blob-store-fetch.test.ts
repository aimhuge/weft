import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOB_REF_PREFIX, type BlobRef } from "./cloud-sync-types";
import { createBlobStore } from "./blob-store";
import { cacheDir, file, makeClient, sha, store, withBlobDirs } from "./blob-store.harness";

withBlobDirs();

describe("fetchBlob", () => {
  // Each test uses a unique ref so a write to the cache in one test doesn't short-circuit the
  // next test's download or error case.
  const refA: BlobRef = `blob:sha256:${"a".repeat(64)}`;
  const refB: BlobRef = `blob:sha256:${"b".repeat(64)}`;
  const refC: BlobRef = `blob:sha256:${"c".repeat(64)}`;
  const refD: BlobRef = `blob:sha256:${"d".repeat(64)}`;

  it("returns null for a malformed ref, returns the cached file when present, downloads a Blob on miss", async () => {
    const bad = "blob:sha256:nothex";
    expect(await store(makeClient()).fetchBlob(bad as never, "orgA")).toBeNull();
    fs.mkdirSync(cacheDir(), { recursive: true });
    const cached = path.join(cacheDir(), "a".repeat(64));
    fs.writeFileSync(cached, "cached!");
    const m1 = makeClient();
    expect(await store(m1).fetchBlob(refA, "orgA")).toBe(cached);
    expect(m1.downloadCalls).toHaveLength(0);
    const m2 = makeClient();
    m2.downloads.push({ data: new Blob(["hello"]), error: null });
    const out = await store(m2).fetchBlob(refB, "orgA");
    expect(m2.downloadCalls).toEqual([`orgA/${"b".repeat(64)}`]);
    expect(out && fs.readFileSync(out, "utf8")).toBe("hello");
  });

  it("downloads a non-Blob body and returns null on error or empty body", async () => {
    const m1 = makeClient();
    m1.downloads.push({ data: new Uint8Array([104, 105]), error: null });
    const out = await store(m1).fetchBlob(refC, "orgA");
    expect(out && fs.readFileSync(out, "utf8")).toBe("hi");
    const m2 = makeClient();
    m2.downloads.push({ data: null, error: { message: "nope" } });
    expect(await store(m2).fetchBlob(refD, "orgA")).toBeNull();
  });
});

describe("a store's veto (a Weft Worker's rule)", () => {
  const vetoing = (m: ReturnType<typeof makeClient>) =>
    createBlobStore({ client: m.client, cacheDir: cacheDir(), mayUpload: (local) => !local.includes("secret") });

  it("refuses a file and a page it vetoes", async () => {
    const m = makeClient();
    expect(await vetoing(m).upload(file("secret.png"), "orgA")).toBeNull();
    expect(await vetoing(m).uploadPage(file("secret.html", "<p>"), "orgA")).toBeNull();
    expect(m.uploadCalls).toEqual([]);
  });

  it("leaves a vetoed asset out of a page, stylesheets included", async () => {
    const m = makeClient();
    file("secret.css", "body{color:red}");
    file("secret.png");
    const page = file("fine.html", '<link rel="stylesheet" href="secret.css"><img src="secret.png">');
    const ref = await vetoing(m).uploadPage(page, "orgA");
    expect(ref).toBe(`${BLOB_REF_PREFIX}${sha('<link rel="stylesheet" href="secret.css"><img src="secret.png">')}`);
    expect(m.uploadCalls.map((c) => c.body.toString())).toEqual(['<link rel="stylesheet" href="secret.css"><img src="secret.png">']);
  });
});

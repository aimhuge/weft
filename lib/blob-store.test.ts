import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "./types";
import { BLOB_BUCKET, BLOB_REF_PREFIX } from "./cloud-sync-types";
import { createBlobStore, isLocalUploadPath, sha256Of } from "./blob-store";
import { DATA, HOME, file, makeClient, sha, store, withBlobDirs } from "./blob-store.harness";

withBlobDirs();

// The path rules themselves (isLocalUploadPath, resolvePage) are tested in lib/blob-paths.test.ts.
describe("isLocalUploadPath re-export", () => {
  it("is the blob-paths check", () => {
    expect(isLocalUploadPath(path.join(HOME, "a.png"), HOME)).toBe(true);
  });
});

describe("sha256Of", () => {
  it("returns null for a missing file or a directory, hashes a real file", async () => {
    expect(await sha256Of(path.join(HOME, "nope.png"))).toBeNull();
    fs.mkdirSync(path.join(HOME, "dir.png"), { recursive: true });
    expect(await sha256Of(path.join(HOME, "dir.png"))).toBeNull();
    const bytes = Buffer.from("abcdef");
    expect(await sha256Of(file("a.bin", bytes))).toBe(sha(bytes));
  });
});

describe("createBlobStore", () => {
  describe("refFor", () => {
    it("returns null for a missing file, blob:sha256:<hex> for a real one", async () => {
      const m = makeClient();
      expect(await store(m).refFor(path.join(HOME, "nope.png"))).toBeNull();
      const bytes = Buffer.from("the quick brown fox");
      expect(await store(m).refFor(file("a.bin", bytes))).toBe(`${BLOB_REF_PREFIX}${sha(bytes)}`);
    });
  });

  describe("upload", () => {
    it("returns null when the file is missing", async () => {
      const m = makeClient();
      expect(await store(m).upload(path.join(HOME, "nope.png"), "org1")).toBeNull();
    });

    it("uploads to <bucket>/<orgId>/<sha> with the right content type, upsert false", async () => {
      const bytes = Buffer.from("PNGbytes");
      const p = file("shot.png", bytes);
      const m = makeClient();
      m.uploads.push({ error: null });
      expect(await store(m).upload(p, "orgA")).toBe(`${BLOB_REF_PREFIX}${sha(bytes)}`);
      expect(m.from).toHaveBeenCalledWith(BLOB_BUCKET);
      expect(m.uploadCalls[0]).toEqual({ path: `orgA/${sha(bytes)}`, body: bytes, opts: { contentType: "image/png", upsert: false } });
    });

    it("uses the right content type for every supported extension", async () => {
      const m = makeClient();
      const types: Array<[string, string]> = [
        ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"], ["gif", "image/gif"],
        ["html", "text/html; charset=utf-8"], ["svg", "image/svg+xml"], ["pdf", "application/pdf"],
        ["bin", "application/octet-stream"],
      ];
      let n = 0;
      for (const [ext, type] of types) {
        const p = file(`x${n++}.${ext}`, `bytes-${n}`); // distinct bytes: avoid per-store cache
        m.uploads.push({ error: null });
        await store(m).upload(p, "orgA");
        expect(m.uploadCalls.at(-1)?.opts.contentType).toBe(type);
      }
    });

    it("treats 409 and 400 'already exists' as success and remembers the ref", async () => {
      const p = file("a.png", "x");
      for (const err of [
        { name: "StorageApiError", statusCode: "409", message: "duplicate" },
        { name: "StorageApiError", statusCode: "400", message: "The resource already exists" },
      ]) {
        const m = makeClient();
        m.uploads.push({ error: err });
        const s = store(m);
        const ref = await s.upload(p, "orgA");
        expect(ref).toMatch(/^blob:sha256:[0-9a-f]{64}$/);
        const before = m.uploadCalls.length;
        expect(await s.upload(p, "orgA")).toBe(ref);
        expect(m.uploadCalls.length).toBe(before);
      }
    });

    it("throws on a non-already-exists error (500, generic, or message-less 500)", async () => {
      const p = file("a.png", "x");
      for (const err of [
        { name: "StorageApiError", statusCode: "500", message: "boom" },
        { name: "OtherError", message: "no internet" },
        { name: "StorageApiError", statusCode: "500" },
      ]) {
        const m = makeClient();
        m.uploads.push({ error: err });
        await expect(store(m).upload(p, "orgA")).rejects.toBeTruthy();
      }
    });

    it("uses dataDir/blob-cache when cacheDir is omitted, and the module default otherwise", async () => {
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null });
      expect(await createBlobStore({ client: m.client, dataDir: DATA }).upload(file("a.png", "1"), "orgA")).toMatch(/^blob:sha256:/);
      expect(await createBlobStore({ client: m.client }).upload(file("b.png", "2"), "orgA")).toMatch(/^blob:sha256:/);
    });
  });

  describe("rewriteItem", () => {
    it("returns the item unchanged when nothing in it points at a local file", async () => {
      const m = makeClient();
      const item = { kind: "user", text: "Hello world, no images here.", at: 1 } as const;
      expect(await store(m).rewriteItem(item, "orgA")).toBe(item);
    });

    it("uploads and rewrites tool.images entries that are local files", async () => {
      const p1 = file("shot1.png", "1");
      const p2 = file("shot2.jpg", "22");
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null });
      const item: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "", at: 1, images: [p1, "/api/attachments/keep.png", `file://${p2}`] };
      const out = await store(m).rewriteItem(item, "orgA");
      expect(out).not.toBe(item);
      if (out.kind === "tool") {
        expect(out.images?.[0]).toMatch(/^blob:sha256:/);
        expect(out.images?.[1]).toBe("/api/attachments/keep.png");
        expect(out.images?.[2]).toMatch(/^blob:sha256:/);
      } else throw new Error("kind changed");
    });

    it("rewrites a user.page that is a local file or a file:// URL", async () => {
      const p = file("page.html", "<html></html>");
      const m = makeClient();
      m.uploads.push({ error: null });
      const out = await store(m).rewriteItem({ kind: "user", text: "", at: 1, page: `file://${p}` } as const, "orgA");
      if (out.kind === "user") expect(out.page).toMatch(/^blob:sha256:/);
      else throw new Error("kind changed");
    });

    it("uploads a page's local images and the rewritten copy, leaving the file on disk alone", async () => {
      const img = file(".weft/show/tour/shot.png", "png-bytes");
      const css = file(".weft/show/tour/site.css", "a{color:red}");
      const html = `<link rel="stylesheet" href="site.css"><img src="shot.png"><img src="https://x.dev/a.png">`;
      const p = file(".weft/show/tour/index.html", html);
      const m = makeClient();
      const out = await store(m).rewriteItem({ kind: "user", text: "", at: 1, page: `${p}#step-2` } as const, "orgA");
      const sent = `<style>\na{color:red}\n</style><img src="${BLOB_REF_PREFIX}${sha("png-bytes")}"><img src="https://x.dev/a.png">`;
      if (out.kind !== "user") throw new Error("kind changed");
      expect(out.page).toBe(`${BLOB_REF_PREFIX}${sha(sent)}#step-2`);
      expect(m.uploadCalls.map((c) => c.path)).toEqual([`orgA/${sha("png-bytes")}`, `orgA/${sha(sent)}`]);
      expect(m.uploadCalls[1]?.body.toString()).toBe(sent);
      expect(m.uploadCalls[1]?.opts.contentType).toBe("text/html; charset=utf-8");
      expect(fs.readFileSync(p, "utf8")).toBe(html);
      expect([img, css].every((f) => fs.existsSync(f))).toBe(true);
    });

    it("uploads a non-HTML page, or one that names nothing local, as it is", async () => {
      const p = file("doc.pdf", "%PDF");
      const m = makeClient();
      const out = await store(m).rewriteItem({ kind: "user", text: "", at: 1, page: p } as const, "orgA");
      if (out.kind === "user") expect(out.page).toBe(`${BLOB_REF_PREFIX}${sha("%PDF")}`);
      expect(m.uploadCalls[0]?.opts.contentType).toBe("application/pdf");
      const plain = file("plain.html", "<p>hi</p>");
      expect(await store(m).uploadPage(plain, "orgA")).toBe(`${BLOB_REF_PREFIX}${sha("<p>hi</p>")}`);
    });

    it("leaves a user.page that is http or a missing file alone", async () => {
      const m = makeClient();
      const s = store(m);
      expect(await s.rewriteItem({ kind: "user", text: "", at: 1, page: "https://example.com" } as const, "orgA")).toEqual({ kind: "user", text: "", at: 1, page: "https://example.com" });
      expect(await s.rewriteItem({ kind: "user", text: "", at: 1, page: path.join(HOME, "nope.html") } as const, "orgA")).toEqual({ kind: "user", text: "", at: 1, page: path.join(HOME, "nope.html") });
    });

    it("keeps a user.page's #hash after the ref", async () => {
      const p = file(".weft/show/plan/index.html", "<p>plan</p>");
      const m = makeClient();
      const out = await store(m).rewriteItem({ kind: "user", text: "", at: 1, page: `file://${p}#step-2` } as const, "orgA");
      expect(out).toEqual({ kind: "user", text: "", at: 1, page: `blob:sha256:${sha("<p>plan</p>")}#step-2` });
      expect(m.uploadCalls[0]?.opts.contentType).toBe("text/html; charset=utf-8");
    });

    it("uploads the local page an open_url call opened and keeps its #hash; sites and localhost stay", async () => {
      const p = file(".weft/show/x/index.html", "<p>x</p>");
      const m = makeClient();
      const s = store(m);
      const open = (summary: string): ThreadItem => ({ kind: "tool", id: "t", name: "mcp__browser__open_url", summary, at: 1 });
      const out = await s.rewriteItem(open(` file://${p}#step-2 `), "orgA");
      expect(out).toEqual({ ...open(""), summary: `blob:sha256:${sha("<p>x</p>")}#step-2` });
      expect(m.uploadCalls.map((c) => c.path)).toEqual([`orgA/${sha("<p>x</p>")}`]);
      for (const url of ["https://example.com/#a", "http://localhost:3000/", path.join(HOME, "missing.html")]) {
        const item = open(url);
        expect(await s.rewriteItem(item, "orgA")).toBe(item);
      }
      // Another tool's summary is never treated as a page.
      const bash: ThreadItem = { kind: "tool", id: "b", name: "Bash", summary: p, at: 1 };
      expect(await s.rewriteItem(bash, "orgA")).toBe(bash);
    });

    it("rewrites markdown image targets (bare and angle-bracketed) and leaves http/localhost alone", async () => {
      const p1 = file("pic.png", "P1");
      const p2 = file("p2.png", "P2");
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null }, { error: null });
      const s = store(m);
      const user = { kind: "user", text: `look ![a](${p1}) and ![b](https://x.test/y)`, at: 1 } as const;
      const out = await s.rewriteItem(user, "orgA");
      if (out.kind === "user") {
        expect(out.text).toMatch(/!\[a\]\(blob:sha256:[0-9a-f]{64}\)/);
        expect(out.text).toContain("https://x.test/y");
      } else throw new Error("kind changed");
      const assistant = { kind: "assistant", text: `![p](<${p2}>)`, at: 1 } as const;
      const out2 = await s.rewriteItem(assistant, "orgA");
      if (out2.kind === "assistant") expect(out2.text).toMatch(/!\[p\]\(blob:sha256:[0-9a-f]{64}\)/);
      else throw new Error("kind changed");
      const skip = { kind: "assistant", text: "![r](https://x.test/y) ![l](http://localhost:3000/a)", at: 1 } as const;
      expect(await s.rewriteItem(skip, "orgA")).toBe(skip);
    });

    it("leaves non-tool, non-user, non-assistant items, tools without images, and unsafe paths alone", async () => {
      const m = makeClient();
      const s = store(m);
      expect(await s.rewriteItem({ kind: "result", text: "ok", isError: false, at: 1 } as const, "orgA")).toEqual({ kind: "result", text: "ok", isError: false, at: 1 });
      expect(await s.rewriteItem({ kind: "tool", id: "t1", name: "Bash", summary: "x", at: 1 } as const, "orgA")).toEqual({ kind: "tool", id: "t1", name: "Bash", summary: "x", at: 1 });
      const outside = { kind: "assistant", text: "![o](/etc/passwd)", at: 1 } as const;
      expect(await s.rewriteItem(outside, "orgA")).toBe(outside);
      const missing = { kind: "assistant", text: `![m](${path.join(HOME, "missing.png")})`, at: 1 } as const;
      expect(await s.rewriteItem(missing, "orgA")).toBe(missing);
      fs.mkdirSync(path.join(HOME, ".weft", "vault"), { recursive: true });
      const secret = path.join(HOME, ".weft", "vault", "k.json");
      fs.writeFileSync(secret, "{}");
      const token = path.join(HOME, "puku-trial-token");
      fs.writeFileSync(token, "x");
      const a = { kind: "assistant", text: `![v](${secret}) ![t](${token})`, at: 1 } as const;
      expect(await s.rewriteItem(a, "orgA")).toBe(a);
    });
  });
});

// lib/web-blob-open.ts: a paired browser swaps sealed pictures for object URLs of their opened bytes and opens a sealed
// page with its assets inlined; plain blobs, and ones it can't fetch or open, keep what they had.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { blobSealer } from "./blob-seal";
import { b64, sodium, type Sodium } from "./sodium";
import { looksLikeHtml, openSealedPage, openSealedUrls } from "./web-blob-open";

let s: Sodium;
let key: { version: number; key: string };
let ring: Map<number, string>;
beforeAll(async () => {
  s = await sodium();
  key = { version: 1, key: b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen()) };
  ring = new Map([[1, key.key]]);
});

const ORG = "org-1";
const enc = (t: string) => new TextEncoder().encode(t);
const shaOf = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const sealed = (b: Uint8Array) => blobSealer(s, key)(ORG, shaOf(b), b);
const ok = (bytes: Uint8Array, type: string) => new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { "content-type": type } });

describe("openSealedUrls", () => {
  it("swaps a sealed picture for an object URL and leaves the rest", async () => {
    const pic = enc("PNG");
    const plain = enc("plain");
    const urls = {
      [`blob:sha256:${shaOf(pic)}`]: "https://r2/pic",
      [`blob:sha256:${shaOf(plain)}`]: "https://r2/plain",
      [`blob:sha256:${"0".repeat(64)}`]: "https://r2/gone",
      [`blob:sha256:${"1".repeat(64)}`]: "https://r2/throws",
      [`blob:sha256:${"2".repeat(64)}`]: "blob:http://x/already",
      other: "https://r2/other",
    };
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      if (url.endsWith("pic")) return Promise.resolve(ok(sealed(pic), "image/png"));
      if (url.endsWith("plain")) return Promise.resolve(ok(plain, "image/png"));
      if (url.endsWith("throws")) return Promise.reject(new Error("cors"));
      return Promise.resolve(new Response("", { status: 404 }));
    });
    const made: Blob[] = [];
    const out = await openSealedUrls(urls, ORG, { s, ring, fetchImpl, toUrl: (b) => (made.push(b), "blob:opened") });
    expect(out).toEqual({ ...urls, [`blob:sha256:${shaOf(pic)}`]: "blob:opened" });
    expect(made[0]?.type).toBe("image/png");
    expect(new Uint8Array(await made[0]!.arrayBuffer())).toEqual(pic);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("keeps a sealed picture's URL when it won't open here", async () => {
    const pic = enc("PNG");
    const urls = { [`blob:sha256:${shaOf(pic)}`]: "https://r2/pic" };
    const out = await openSealedUrls(urls, ORG, { s, ring: new Map(), fetchImpl: () => Promise.resolve(ok(sealed(pic), "")), toUrl: () => "nope" });
    expect(out).toEqual(urls);
  });
});

describe("openSealedPage", () => {
  it("is null for a plain page or one it can't fetch, and locked for one it can't open", async () => {
    const page = enc("<html>hi</html>");
    const sha = shaOf(page);
    expect(await openSealedPage(ORG, sha, { s, ring, fetchImpl: () => Promise.resolve(ok(page, "text/html")) })).toBeNull();
    expect(await openSealedPage(ORG, sha, { s, ring, fetchImpl: () => Promise.resolve(new Response("", { status: 401 })) })).toBeNull();
    expect(await openSealedPage(ORG, sha, { s, ring: new Map(), fetchImpl: () => Promise.resolve(ok(sealed(page), "text/plain")) })).toEqual({ kind: "locked" });
  });

  it("opens a sealed page and inlines its assets, sealed or plain, as data URLs", async () => {
    const a = enc("A");
    const b = enc("B");
    const missing = "f".repeat(64);
    const page = enc(`<!doctype html><img src="blob:sha256:${shaOf(a)}"><img src="blob:sha256:${shaOf(b)}"><img src="blob:sha256:${missing}"><img src="blob:sha256:${shaOf(a)}">`);
    const bySha: Record<string, Response> = {};
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = input as string;
      expect(url).toMatch(new RegExp(`^/api/web-board/${ORG}/page/[0-9a-f]{64}\\?sealed=1$`));
      const sha = url.split("/").pop()!.slice(0, 64);
      if (sha === shaOf(page)) return Promise.resolve(ok(sealed(page), "text/plain"));
      if (sha === shaOf(a)) return Promise.resolve(ok(sealed(a), "image/png; x=1"));
      if (sha === shaOf(b)) return Promise.resolve(ok(b, ""));
      return Promise.resolve(bySha[sha] ?? new Response("", { status: 404 }));
    });
    const got = await openSealedPage(ORG, shaOf(page), { s, ring, fetchImpl });
    expect(got).toEqual({
      kind: "html",
      html: `<!doctype html><img src="data:image/png;base64,${btoa("A")}"><img src="data:application/octet-stream;base64,${btoa("B")}"><img src="blob:sha256:${missing}"><img src="data:image/png;base64,${btoa("A")}">`,
    });
  });

  it("hands any other file over as an object URL", async () => {
    const pdf = enc("%PDF-1.7");
    const made: Blob[] = [];
    const got = await openSealedPage(ORG, shaOf(pdf), { s, ring, fetchImpl: () => Promise.resolve(ok(sealed(pdf), "application/pdf")), toUrl: (blob) => (made.push(blob), "blob:pdf") });
    expect(got).toEqual({ kind: "file", url: "blob:pdf" });
    expect(made[0]?.type).toBe("application/pdf");
  });
});

describe("defaults", () => {
  it("fetches with the browser's fetch and makes object URLs", async () => {
    const pdf = enc("%PDF");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(sealed(pdf) as Uint8Array<ArrayBuffer>))));
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:made");
    expect(await openSealedPage(ORG, shaOf(pdf), { s, ring })).toEqual({ kind: "file", url: "blob:made" });
    expect(await openSealedUrls({ [`blob:sha256:${shaOf(pdf)}`]: "https://r2/x" }, ORG, { s, ring })).toEqual({ [`blob:sha256:${shaOf(pdf)}`]: "blob:made" });
    expect((created.mock.calls[0]?.[0] as Blob).type).toBe("");
    created.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("looksLikeHtml", () => {
  it("knows a page by its start, past a BOM and whitespace", () => {
    expect(looksLikeHtml(enc("﻿  <!DOCTYPE html>"))).toBe(true);
    expect(looksLikeHtml(enc("<html lang=en>"))).toBe(true);
    expect(looksLikeHtml(enc("%PDF"))).toBe(false);
  });
});

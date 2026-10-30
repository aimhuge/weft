// lib/share-page-serve.ts: serveBlobPage streams a file from weft-blobs with a strict CSP sandbox
// so the page's scripts run in an opaque origin and can't read weft.zip's cookies. serveBlobFile
// does the same for a folder file with a content type from the file's extension. Text gets the
// same key-shaped redaction the thread does; binary bytes pass through untouched.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signPageAssets = vi.fn((_c: unknown, _o: string, html: string) => Promise.resolve(html.replace("blob:sha256:x", "https://signed/x")));
vi.mock("./blob-page-sign", () => ({ signPageAssets: (...a: [unknown, string, string]) => signPageAssets(...a) }));

import { folderFileType, NO_STORE, serveBlobFile, serveBlobPage } from "./share-page-serve";

beforeEach(() => {
  vi.clearAllMocks();
});

function serviceWith(blob: { data: Blob | null; error: { message: string } | null }): SupabaseClient {
  const download = vi.fn(() => Promise.resolve(blob));
  return { storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
}

describe("serveBlobPage", () => {
  it("returns 404 when the storage download errors", async () => {
    const service = serviceWith({ data: null, error: { message: "Object not found" } });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves an HTML blob stored as text/plain as text/html with the CSP sandbox header", async () => {
    const html = "<!doctype html><title>Done → ok</title>";
    const service = serviceWith({ data: new Blob([html], { type: "text/plain" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-forms");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await res.text()).toBe(html);
  });

  it("signs a pane page's asset refs only when asked, and only for HTML", async () => {
    const html = `<!doctype html><img src="blob:sha256:x">`;
    const signed = await serveBlobPage(serviceWith({ data: new Blob([html], { type: "text/plain" }), error: null }), "org-1", "a".repeat(64), { signAssets: true });
    expect(await signed.text()).toBe(`<!doctype html><img src="https://signed/x">`);
    const plain = await serveBlobPage(serviceWith({ data: new Blob([html], { type: "text/plain" }), error: null }), "org-1", "a".repeat(64));
    expect(await plain.text()).toBe(html);
    await serveBlobPage(serviceWith({ data: new Blob(["blob:sha256:x"], { type: "text/css" }), error: null }), "org-1", "a".repeat(64), { signAssets: true });
    expect(signPageAssets).toHaveBeenCalledTimes(1);
  });

  it("masks key-shaped text in a text page, the way the thread is", async () => {
    // Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
    const key = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
    const service = serviceWith({ data: new Blob([`<p>key ${key}</p>`], { type: "text/html" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    const text = await res.text();
    expect(text).not.toContain(key);
    expect(text).toContain("‹hidden: a Stripe secret key›");
  });

  it("passes a non-text blob through as bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const service = serviceWith({ data: new Blob([bytes], { type: "image/png" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("downloads from weft-blobs under <orgId>/<sha>", async () => {
    const sha = "a".repeat(64);
    const download = vi.fn(() => Promise.resolve({ data: new Blob(["x"], { type: "text/plain" }), error: null }));
    const service = { storage: { from: (bucket: string) => { expect(bucket).toBe("weft-blobs"); return { download }; } } } as unknown as SupabaseClient;
    await serveBlobPage(service, "org-9", sha);
    expect(download).toHaveBeenCalledWith(`org-9/${sha}`);
  });

  it("re-exports the no-store header for the calling route's 404 / 403 / 503", () => {
    expect(NO_STORE).toEqual({ "Cache-Control": "no-store" });
  });
});

describe("folderFileType", () => {
  it("returns the canonical content type for known extensions, with charset for text", () => {
    expect(folderFileType("html")).toBe("text/html; charset=utf-8");
    expect(folderFileType("htm")).toBe("text/html; charset=utf-8");
    expect(folderFileType("css")).toBe("text/css; charset=utf-8");
    expect(folderFileType("js")).toBe("text/javascript; charset=utf-8");
    expect(folderFileType("mjs")).toBe("text/javascript; charset=utf-8");
    expect(folderFileType("json")).toBe("application/json; charset=utf-8");
    expect(folderFileType("svg")).toBe("image/svg+xml; charset=utf-8");
    expect(folderFileType("png")).toBe("image/png");
    expect(folderFileType("jpg")).toBe("image/jpeg");
    expect(folderFileType("jpeg")).toBe("image/jpeg");
    expect(folderFileType("gif")).toBe("image/gif");
    expect(folderFileType("webp")).toBe("image/webp");
    expect(folderFileType("ico")).toBe("image/x-icon");
    expect(folderFileType("woff")).toBe("font/woff");
    expect(folderFileType("woff2")).toBe("font/woff2");
    expect(folderFileType("txt")).toBe("text/plain; charset=utf-8");
    expect(folderFileType("map")).toBe("application/json; charset=utf-8");
  });

  it("normalises the case and a leading dot before lookup", () => {
    expect(folderFileType("HTML")).toBe("text/html; charset=utf-8");
    expect(folderFileType(".html")).toBe("text/html; charset=utf-8");
    expect(folderFileType(".PNG")).toBe("image/png");
  });

  it("returns application/octet-stream for unknown extensions so the route still works", () => {
    expect(folderFileType("xyz")).toBe("application/octet-stream");
    expect(folderFileType("")).toBe("application/octet-stream");
  });
});

describe("serveBlobFile", () => {
  it("returns 404 when the storage download errors", async () => {
    const service = serviceWith({ data: null, error: { message: "Object not found" } });
    const res = await serveBlobFile(service, "org-1", "a".repeat(64), "html");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the file with the type from the extension, not the storage-declared type", async () => {
    const service = serviceWith({ data: new Blob(["body { color: red; }"], { type: "text/plain" }), error: null });
    const res = await serveBlobFile(service, "org-1", "a".repeat(64), "css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-forms");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await res.text()).toBe("body { color: red; }");
  });

  it("masks key-shaped text in a text file", async () => {
    const key = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
    const service = serviceWith({ data: new Blob([`const k = "${key}";`], { type: "text/plain" }), error: null });
    const res = await serveBlobFile(service, "org-1", "a".repeat(64), "js");
    const text = await res.text();
    expect(text).not.toContain(key);
    expect(text).toContain("‹hidden: a Stripe secret key›");
  });

  it("passes a non-text file through as bytes with the right type", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const service = serviceWith({ data: new Blob([bytes], { type: "application/octet-stream" }), error: null });
    const res = await serveBlobFile(service, "org-1", "a".repeat(64), "png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });
});

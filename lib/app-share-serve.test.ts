import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAppShareRow } from "./app-share-types";

vi.mock("server-only", () => ({}));

const { appShareAccess, serviceClient, serveBlobFile, serveBlobPage, pageLimitVerdict } = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  serveBlobFile: vi.fn(),
  serveBlobPage: vi.fn(),
  pageLimitVerdict: vi.fn(),
}));

vi.mock("./app-share-access", () => ({ appShareAccess }));
vi.mock("./web-session", () => ({ serviceClient }));
vi.mock("./share-page-serve", () => ({ serveBlobFile, serveBlobPage }));
vi.mock("./app-page-limit", () => ({ pageLimitVerdict }));

import { APP_CDN_SECONDS, appCacheHeaders, folderEntrySha, safeParts, serveAppFile, serveAppPage } from "./app-share-serve";
import { folderVersion } from "./app-share-frame";

const A = "a".repeat(64);
const B = "b".repeat(64);
const FILES = { "index.html": A, "app.js": B };
const VER = folderVersion(FILES);

function share(over: Partial<CloudAppShareRow> = {}): CloudAppShareRow {
  return {
    id: "s1", org_id: "org-1", app_id: "app-1", name: "growth", mode: "public", kind: "blob",
    page: `blob:sha256:${A}`, owner: "user", slug: "growth", files: null, manifest: null,
    created_at: "", updated_at: "", ...over,
  };
}

const folder = (over: Partial<CloudAppShareRow> = {}) => share({ kind: "folder", page: "index.html", files: FILES, ...over });
const req = () => new Request("https://weft.zip/api/a/s1/x");
const html = () => new Response("<html><head></head><body>hi</body></html>", { headers: { "Content-Type": "text/html", "Cache-Control": "private, max-age=300" } });

beforeEach(() => {
  vi.clearAllMocks();
  pageLimitVerdict.mockReturnValue({ ok: true });
  serviceClient.mockReturnValue({});
  appShareAccess.mockResolvedValue({ kind: "ok", share: share() });
  serveBlobPage.mockImplementation(() => Promise.resolve(html()));
  serveBlobFile.mockImplementation((_s, _o, _sha, ext: string) =>
    Promise.resolve(ext === "html" ? html() : new Response("js();", { headers: { "Content-Type": "text/javascript" } })),
  );
});

describe("appCacheHeaders", () => {
  it("lets the CDN keep a versioned public answer and nothing else", () => {
    expect(appCacheHeaders("public", true)).toEqual({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Vercel-CDN-Cache-Control": `max-age=${APP_CDN_SECONDS}`,
    });
    for (const mode of ["private", "email", "password"]) expect(appCacheHeaders(mode, true)).toEqual({ "Cache-Control": "private, max-age=300" });
    expect(appCacheHeaders("public", false)).toEqual({ "Cache-Control": "private, max-age=300" });
  });
});

describe("serveAppPage", () => {
  it("serves the row's page with the bridge, cacheable at its sha when public", async () => {
    const res = await serveAppPage(req(), "s1", A);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe(`max-age=${APP_CDN_SECONDS}`);
    const body = await res.text();
    expect(body).toContain("window.weft");
    expect(body).toContain('"https://weft.zip"');
    expect(res.headers.get("Content-Length")).toBe(String(new TextEncoder().encode(body).byteLength));
  });

  it("keeps a private, email or password link out of the CDN", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: share({ mode: "password" }) });
    const res = await serveAppPage(req(), "s1", A);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });

  it("keeps the unversioned URL out of the CDN", async () => {
    const res = await serveAppPage(req(), "s1");
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });

  it("refuses a sha the row no longer names, uncached", async () => {
    const res = await serveAppPage(req(), "s1", B);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toMatch(/changed/);
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("refuses a malformed sha before the gate", async () => {
    expect((await serveAppPage(req(), "s1", "nope")).status).toBe(404);
    expect(appShareAccess).not.toHaveBeenCalled();
  });

  it("serves a folder's entry through the page URL", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: folder() });
    expect((await serveAppPage(req(), "s1", A)).status).toBe(200);
  });

  it("answers 429 before the gate when the cap is hit", async () => {
    pageLimitVerdict.mockReturnValue({ ok: false, bucket: "ip", retryAfter: 12 });
    const res = await serveAppPage(req(), "s1", A);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(appShareAccess).not.toHaveBeenCalled();
  });

  it("answers 404, 403 and 503 for a missing row, a refused gate and no service", async () => {
    appShareAccess.mockResolvedValueOnce({ kind: "missing" });
    expect((await serveAppPage(req(), "s1")).status).toBe(404);
    appShareAccess.mockResolvedValueOnce({ kind: "denied" });
    expect((await serveAppPage(req(), "s1")).status).toBe(403);
    appShareAccess.mockResolvedValueOnce({ kind: "ok", share: share({ kind: "site", page: "https://x.com" }) });
    expect((await serveAppPage(req(), "s1")).status).toBe(404);
    serviceClient.mockReturnValueOnce(null);
    expect((await serveAppPage(req(), "s1")).status).toBe(503);
  });

  it("passes a missing blob's reply through", async () => {
    serveBlobPage.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    expect((await serveAppPage(req(), "s1")).status).toBe(404);
  });
});

describe("serveAppFile", () => {
  beforeEach(() => appShareAccess.mockResolvedValue({ kind: "ok", share: folder() }));

  it("serves a versioned script byte-identical and cacheable", async () => {
    const res = await serveAppFile(req(), "s1", ["app.js"], VER);
    expect(await res.text()).toBe("js();");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(serveBlobFile).toHaveBeenCalledWith({}, "org-1", B, "js");
  });

  it("injects the bridge into a folder's HTML", async () => {
    const res = await serveAppFile(req(), "s1", ["index.html"], VER);
    expect(await res.text()).toContain("window.weft");
  });

  it("refuses a version the files map no longer has", async () => {
    const res = await serveAppFile(req(), "s1", ["app.js"], "0".repeat(32));
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("serves the unversioned URL privately", async () => {
    const res = await serveAppFile(req(), "s1", ["app.js"]);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("refuses unsafe paths, unknown files, bad shas, a non-folder and no service", async () => {
    expect((await serveAppFile(req(), "s1", ["..", "x"])).status).toBe(404);
    expect((await serveAppFile(req(), "s1", ["nope.js"])).status).toBe(404);
    appShareAccess.mockResolvedValueOnce({ kind: "ok", share: folder({ files: { "x.js": "../evil" } }) });
    expect((await serveAppFile(req(), "s1", ["x.js"])).status).toBe(404);
    appShareAccess.mockResolvedValueOnce({ kind: "ok", share: share() });
    expect((await serveAppFile(req(), "s1", ["app.js"])).status).toBe(404);
    serviceClient.mockReturnValueOnce(null);
    expect((await serveAppFile(req(), "s1", ["app.js"])).status).toBe(503);
  });

  it("passes the cap and gate replies through", async () => {
    appShareAccess.mockResolvedValueOnce({ kind: "login" });
    expect((await serveAppFile(req(), "s1", ["app.js"])).status).toBe(403);
    pageLimitVerdict.mockReturnValueOnce({ ok: false, bucket: "share", retryAfter: 3 });
    expect((await serveAppFile(req(), "s1", ["app.js"])).status).toBe(429);
  });

  it("passes a missing blob's reply through", async () => {
    serveBlobFile.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    expect((await serveAppFile(req(), "s1", ["app.js"])).status).toBe(404);
  });

  it("serves a file with no extension", async () => {
    appShareAccess.mockResolvedValueOnce({ kind: "ok", share: folder({ files: { LICENSE: A } }) });
    expect((await serveAppFile(req(), "s1", ["LICENSE"])).status).toBe(200);
    expect(serveBlobFile).toHaveBeenCalledWith({}, "org-1", A, "");
  });
});

describe("safeParts", () => {
  it("accepts plain segments and refuses everything else", () => {
    expect(safeParts(["assets", "x.png"])).toEqual(["assets", "x.png"]);
    for (const bad of [[], "x", ["a%2Fb"], ["."], [".."], [""], [1], ["a b"], ["%E0%A4%A"]]) expect(safeParts(bad)).toBeNull();
  });
});

describe("folderEntrySha", () => {
  it("answers the entry's sha for a well-formed folder", () => {
    expect(folderEntrySha(folder())).toBe(A);
    expect(folderEntrySha(share())).toBeNull();
    expect(folderEntrySha(folder({ files: null }))).toBeNull();
    expect(folderEntrySha(folder({ files: { "index.html": "x" } }))).toBeNull();
  });
});

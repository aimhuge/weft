// The versioned frame routes: app/api/a/[id]/page/[sha] and app/api/a/[id]/v/[ver]/[...path] hand their params to
// lib/app-share-serve.ts, and the folder one refuses a version that isn't 32 hex characters before anything runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { serveAppPage, serveAppFile } = vi.hoisted(() => ({ serveAppPage: vi.fn(), serveAppFile: vi.fn() }));
vi.mock("@/lib/app-share-serve", () => ({ serveAppPage, serveAppFile }));
vi.mock("server-only", () => ({}));

const { GET: getFile } = await import("./route");
const { GET: getPage } = await import("../../../page/[sha]/route");

const VER = "0123456789abcdef0123456789abcdef";
const SHA = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  serveAppPage.mockResolvedValue(new Response("page"));
  serveAppFile.mockResolvedValue(new Response("file"));
});

describe("GET /api/a/[id]/v/[ver]/[...path]", () => {
  it("serves the file at that version", async () => {
    const req = new Request(`https://weft.zip/api/a/s1/v/${VER}/app.js`);
    const res = await getFile(req, { params: Promise.resolve({ id: "s1", ver: VER, path: ["app.js"] }) });
    expect(await res.text()).toBe("file");
    expect(serveAppFile).toHaveBeenCalledWith(req, "s1", ["app.js"], VER);
  });

  it("refuses a malformed version", async () => {
    const res = await getFile(new Request("https://weft.zip/x"), { params: Promise.resolve({ id: "s1", ver: "nope", path: ["app.js"] }) });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(serveAppFile).not.toHaveBeenCalled();
  });
});

describe("GET /api/a/[id]/page/[sha]", () => {
  it("serves the page at that sha", async () => {
    const req = new Request(`https://weft.zip/api/a/s1/page/${SHA}`);
    const res = await getPage(req, { params: Promise.resolve({ id: "s1", sha: SHA }) });
    expect(await res.text()).toBe("page");
    expect(serveAppPage).toHaveBeenCalledWith(req, "s1", SHA);
  });
});

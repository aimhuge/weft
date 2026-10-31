// app/api/worker-board/page/[sha]/route.ts: a worker's page on the desktop board. The CSP is the point: the frame
// shares the session that puts the launch token on every request to this server.
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerPage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/worker-board", () => ({ workerPage }));
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const { GET } = await import("./route");

const SHA = "a".repeat(64);
const get = (sha = SHA, headers: Record<string, string> = { host: "127.0.0.1:3000", "x-weft-token": "1" }) =>
  GET(new Request(`http://127.0.0.1:3000/api/worker-board/page/${sha}`, { headers }), { params: Promise.resolve({ sha }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/worker-board/page/[sha]", () => {
  it("serves the page sandboxed, with nothing that can reach this server", async () => {
    workerPage.mockResolvedValue({ body: "<p>hi</p>", type: "text/html; charset=utf-8" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<p>hi</p>");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).not.toMatch(/\bhttp:|'self'|localhost|127\.0\.0\.1/);
    expect(csp).toContain("form-action 'none'");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses another host", async () => {
    expect((await get(SHA, { host: "evil.example" })).status).toBe(403);
    expect(workerPage).not.toHaveBeenCalled();
  });

  it("refuses a bad sha, and 404s one it can't read", async () => {
    expect((await get("nope")).status).toBe(400);
    workerPage.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("passes on a signed-out read", async () => {
    workerPage.mockRejectedValue(new Error("Sign in to Weft to reach your worker."));
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Sign in to Weft to reach your worker." });
  });
});

// proxy.ts's host routing for sign.weft.zip (lib/sign-origin.ts): that host serves only its passkey pages, under their
// CSP, and every other path there is a 404; the sign files are a 404 on weft.zip. Imports the real proxy from the root.
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth: { getClaims: () => Promise.resolve({ data: null }) } })) }));
const { proxy, config } = await import("../proxy");

const at = (url: string) => proxy(new NextRequest(url, { headers: { host: new URL(url).host } }));

describe("proxy on sign.weft.zip", () => {
  it("rewrites its pages to the static files, with the strict CSP", async () => {
    for (const [path, file] of [
      ["/approve?card=c&pending=p", "/sign/approve.html"],
      ["/pair", "/sign/pair.html"],
      ["/app.js", "/sign/app.js"],
    ]) {
      const res = await at(`https://sign.weft.zip${path}`);
      expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(file);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("unsafe-inline");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("treats a trailing dot as the same host", async () => {
    const res = await proxy(new NextRequest("https://sign.weft.zip./login", { headers: { host: "sign.weft.zip." } }));
    expect(res.status).toBe(404);
  });

  it("is a 404 for anything else there, with the CSP too", async () => {
    for (const path of ["/", "/acme/board", "/api/cards", "/_next/static/x.js", "/login"]) {
      const res = await at(`https://sign.weft.zip${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });

  it("is a 404 for the sign files on weft.zip", async () => {
    const res = await at("https://weft.zip/sign/approve.html");
    expect(res.status).toBe(404);
    expect((await at("https://weft.zip/sign/app.js")).status).toBe(404);
  });

  it("runs on every path of the sign host and on /sign elsewhere", () => {
    const hosts = config.matcher.flatMap((m) => (typeof m === "string" ? [] : m.has.map((h) => new RegExp(`^${h.value}$`))));
    expect(hosts.some((r) => r.test("sign.weft.zip") && r.test("sign.weft.zip."))).toBe(true);
    expect(hosts.some((r) => r.test("signxweftxzip") || r.test("evil-sign.weft.zip") || r.test("sign.weft.zip.evil.com"))).toBe(false);
    expect(config.matcher).toContain("/sign/:path*");
  });
});

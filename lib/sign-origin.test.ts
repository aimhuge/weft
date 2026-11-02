import { describe, expect, it } from "vitest";
import { SIGN_HEADERS, signApproveUrl, signCsp, signHosts, signRoute } from "./sign-origin";

const HOSTS = signHosts({});

describe("signRoute", () => {
  it("serves only the passkey pages and their files on sign.weft.zip", () => {
    expect(signRoute("sign.weft.zip", "/pair", HOSTS)).toEqual({ rewrite: "/sign/pair.html" });
    expect(signRoute("sign.weft.zip", "/approve", HOSTS)).toEqual({ rewrite: "/sign/approve.html" });
    expect(signRoute("sign.weft.zip", "/app.js", HOSTS)).toEqual({ rewrite: "/sign/app.js" });
    expect(signRoute("SIGN.weft.zip:443", "/app.css", HOSTS)).toEqual({ rewrite: "/sign/app.css" });
    expect(signRoute("sign.weft.zip.", "/pair", HOSTS)).toEqual({ rewrite: "/sign/pair.html" });
  });

  it("is a 404 for everything else on sign.weft.zip: the board, the API, Next's own files", () => {
    for (const path of ["/", "/acme/board", "/api/cards", "/_next/static/chunks/x.js", "/login", "/pair/x", "/sign/pair.html", "/favicon.ico"]) {
      expect(signRoute("sign.weft.zip", path, HOSTS)).toEqual({ notFound: true });
    }
  });

  it("is a 404 for the sign files on weft.zip and every other host, and leaves the rest alone", () => {
    expect(signRoute("weft.zip", "/sign/approve.html", HOSTS)).toEqual({ notFound: true });
    expect(signRoute("weft.zip", "/sign/app.js", HOSTS)).toEqual({ notFound: true });
    expect(signRoute("weft.zip", "/sign", HOSTS)).toEqual({ notFound: true });
    expect(signRoute(null, "/sign/pair.html", HOSTS)).toEqual({ notFound: true });
    expect(signRoute("weft.zip", "/approve", HOSTS)).toBeNull();
    expect(signRoute("weft.zip", "/pair", HOSTS)).toBeNull();
    expect(signRoute("weft.zip", "/signup", HOSTS)).toBeNull();
    expect(signRoute("evil.sign.weft.zip", "/approve", HOSTS)).toBeNull();
  });

  it("takes a dev host only outside production", () => {
    expect(signHosts({ WEFT_SIGN_HOST: "sign.localhost" })).toEqual(["sign.weft.zip", "sign.localhost"]);
    expect(signHosts({ WEFT_SIGN_HOST: "sign.localhost", NODE_ENV: "production" })).toEqual(["sign.weft.zip"]);
    expect(signRoute("sign.localhost:5001", "/approve", signHosts({ WEFT_SIGN_HOST: "sign.localhost" }))).toEqual({ rewrite: "/sign/approve.html" });
  });
});

describe("signCsp", () => {
  it("allows no inline script or style, nothing from elsewhere, connections to Supabase only, and no framing", () => {
    const csp = signCsp("https://abc.supabase.co");
    expect(csp).toBe(
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src https://abc.supabase.co wss://abc.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    expect(csp).not.toContain("unsafe-inline");
    expect(signCsp()).toContain("supabase.co");
    expect(SIGN_HEADERS["X-Frame-Options"]).toBe("DENY");
  });
});

describe("signApproveUrl", () => {
  it("carries only the card and pending ids", () => {
    expect(signApproveUrl("https://sign.weft.zip", "c 1", "p&2")).toBe("https://sign.weft.zip/approve?card=c+1&pending=p%262");
  });
});

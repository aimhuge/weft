// lib/app-bridge-inject.ts: the inline script that defines window.weft inside a hosted app's
// sandboxed frame, and the helper that splices it into the served HTML. The script is plain text
// (the route inserts it), and the injector is a small HTML-aware string transform: it places the
// script after <head>, or after <!doctype html> when <head> is missing, leaving the rest alone.
// Empty or opaque ("null") parent origins disable the bridge entirely: a noop window.weft whose
// methods all reject, so a malformed URL never gets a bridge that would accept any origin.
import { describe, expect, it } from "vitest";
import { bridgeScript, injectBridgeScript, parentOriginFromRequest } from "./app-bridge-inject";

describe("bridgeScript", () => {
  it("defines window.weft with the four methods, with the parent origin as a literal", () => {
    const src = bridgeScript("https://weft.zip");
    expect(src.startsWith("window.weft =")).toBe(true);
    // The parent origin is interpolated as a JSON string, so a quote or backslash in the URL
    // can't break out of the literal. The route's only caller passes new URL(req.url).origin.
    expect(src).toContain('"https://weft.zip"');
    expect(src).toContain("fetch");
    expect(src).toContain("read");
    expect(src).toContain("env");
    expect(src).toContain("requestSecret");
    // The Mac's data-app calls, so a page written for the Mac's pane (Growth) runs on weft.zip.
    expect(src).toContain("access: function");
    expect(src).toContain("requestAccess: function");
    expect(src).toContain("revoke: function");
    expect(src).not.toContain('"NOOP", true');
  });

  it("honours a custom timeout for the request rejection", () => {
    const src = bridgeScript("https://weft.zip", 5_000);
    expect(src).toContain("5000");
  });

  it("escapes a parent origin that contains a double-quote or backslash", () => {
    // JSON.stringify produces a safe literal even if the input is unusual; the route only ever
    // passes new URL(req.url).origin, but a hostile value must not break out of the literal.
    const src = bridgeScript('https://x";\nparent.postMessage("oops","*")');
    expect(src).toContain('\\"oops\\"');
  });

  it("disables the bridge (a noop window.weft) when the parent origin is empty", () => {
    const src = bridgeScript("");
    expect(src).toContain('PARENT_ORIGIN = ""');
    expect(src).toContain('NOOP = true');
    expect(src).toContain("bridge disabled");
  });

  it("disables the bridge when the parent origin is the literal \"null\" (opaque-origin URL)", () => {
    // about:blank has no real origin; new URL("about:blank").origin is the string "null", which
    // would match no origin in practice (every origin is non-"null"). Fail closed: a noop bridge
    // is still better than an inert one that a debugging tool could confuse for "working".
    const src = bridgeScript("null");
    expect(src).toContain('NOOP = true');
  });
});

describe("injectBridgeScript", () => {
  it("inserts the script right after <head>", () => {
    const html = "<!doctype html><html><head><title>Growth</title></head><body></body></html>";
    const out = injectBridgeScript(html, "https://weft.zip");
    expect(out).toMatch(/<head><script>window\.weft[\s\S]*?<\/script><title>Growth<\/title>/);
  });

  it("preserves a <head> with attributes", () => {
    const html = '<html><head class="x"><meta charset="utf-8"></head><body></body></html>';
    const out = injectBridgeScript(html, "https://weft.zip");
    expect(out).toMatch(/<head class="x"><script>window\.weft[\s\S]*?<\/script><meta charset="utf-8">/);
  });

  it("is case-insensitive about <head>", () => {
    const html = "<HTML><HEAD><title>Growth</title></HEAD><body></body></HTML>";
    const out = injectBridgeScript(html, "https://weft.zip");
    expect(out).toMatch(/<HEAD><script>window\.weft[\s\S]*?<\/script><title>Growth<\/title>/);
  });

  it("inserts the script right after <!doctype html> when <head> is missing", () => {
    const html = "<!doctype html><html><body><script>app();</script></body></html>";
    const out = injectBridgeScript(html, "https://weft.zip");
    // The script comes before the body's own script so window.weft is defined when the app runs.
    expect(out).toMatch(/<!doctype html><script>window\.weft[\s\S]*?<\/script><html>/);
  });

  it("inserts the script right after <html> when there is no <head> and no <!doctype>", () => {
    const html = "<html><body>hi</body></html>";
    const out = injectBridgeScript(html, "https://weft.zip");
    expect(out).toMatch(/<html><script>window\.weft[\s\S]*?<\/script><body>hi<\/body>/);
  });

  it("prepends the script when the input has no html structure at all", () => {
    const out = injectBridgeScript("plain", "https://weft.zip");
    expect(out.startsWith("<script>window.weft")).toBe(true);
  });

  it("leaves the body untouched", () => {
    const html = "<!doctype html><html><head></head><body><p>hi</p><script>app();</script></body></html>";
    const out = injectBridgeScript(html, "https://weft.zip");
    expect(out).toContain("<p>hi</p>");
    expect(out).toContain("app();");
  });

  it("returns the HTML unchanged when the parent origin is empty (no bridge in the response)", () => {
    const html = "<!doctype html><html><head></head><body><p>hi</p></body></html>";
    expect(injectBridgeScript(html, "")).toBe(html);
    expect(injectBridgeScript(html, "null")).toBe(html);
  });
});

describe("parentOriginFromRequest", () => {
  it("returns the origin of the request URL", () => {
    expect(parentOriginFromRequest(new Request("https://weft.zip/@u/apps/s"))).toBe("https://weft.zip");
    expect(parentOriginFromRequest(new Request("http://localhost:3000/a/x"))).toBe("http://localhost:3000");
  });

  it("returns the empty string for an opaque origin (about:blank) so the bridge is disabled", () => {
    // about:blank has no real origin; new URL(...) gives "null". A bridge script that accepted
    // "null" as the parent origin would refuse every message it gets back (no real origin matches
    // the literal), so the request would hang — and the bridge would still pass any check that
    // happened to match the literal. Refuse at the boundary.
    expect(parentOriginFromRequest(new Request("about:blank"))).toBe("");
  });

  it("returns the empty string for a request URL that fails to parse", () => {
    // Construct a Request whose .url getter throws to simulate the edge cases a misrouted proxy
    // can produce.
    const req = { get url() { throw new TypeError("opaque"); } } as unknown as Request;
    expect(parentOriginFromRequest(req)).toBe("");
  });
});
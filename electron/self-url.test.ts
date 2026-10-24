import { describe, expect, it } from "vitest";
import { isSelfUrl } from "./self-url.cjs";

const own = "http://localhost:3000/";

describe("isSelfUrl", () => {
  it("matches Weft's own server, localhost and 127.0.0.1 as one host", () => {
    expect(isSelfUrl("http://localhost:3000/board", own)).toBe(true);
    expect(isSelfUrl("http://127.0.0.1:3000/", own)).toBe(true);
  });

  it("lets other ports and hosts through", () => {
    expect(isSelfUrl("http://localhost:3001/", own)).toBe(false);
    expect(isSelfUrl("https://example.com/", own)).toBe(false);
    // Any path on Weft's own server is Weft, even an API route.
    expect(isSelfUrl("http://localhost:3000/api/tags", own)).toBe(true);
  });

  it("lets a feature intro page through, but nothing else under /intros", () => {
    expect(isSelfUrl("http://localhost:3000/intros/newthread.html?live=1", own)).toBe(false);
    expect(isSelfUrl("http://localhost:3000/intros/", own)).toBe(true);
    expect(isSelfUrl("http://localhost:3000/intros/../board", own)).toBe(true);
  });

  it("never treats file:// pages as Weft, even when Weft itself shows one", () => {
    expect(isSelfUrl("file:///tmp/weft-show/a.html", "file:///Applications/Weft/splash.html")).toBe(false);
    expect(isSelfUrl("file:///tmp/weft-show/a.html", own)).toBe(false);
    expect(isSelfUrl("http://localhost:3000/", "file:///splash.html")).toBe(false);
    expect(isSelfUrl("about:blank", "about:blank")).toBe(false);
  });

  it("is false with no app view or an unparsable url", () => {
    expect(isSelfUrl("http://localhost:3000/", undefined)).toBe(false);
    expect(isSelfUrl("not a url", own)).toBe(false);
  });
});

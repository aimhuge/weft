import { describe, expect, it } from "vitest";
import { cardShareLink, threadPublicUrl } from "./share-types";
import { CARD_SHARE_MODES, isCardShareMode, newShareId, paneFor, paneFromUrl, seedShareState, SHARE_ID_RE, shareUrl } from "./share-types";
import type { ThreadItem } from "./types";

const SHA = "a".repeat(64);

describe("card share modes", () => {
  it("takes the four read modes and never public_edit", () => {
    for (const mode of CARD_SHARE_MODES) expect(isCardShareMode(mode)).toBe(true);
    expect(isCardShareMode("public_edit")).toBe(false);
    expect(isCardShareMode("open")).toBe(false);
    expect(isCardShareMode(undefined)).toBe(false);
  });
});

describe("share ids and urls", () => {
  it("makes unguessable path-safe ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newShareId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(SHARE_ID_RE);
  });

  it("puts the id under /s on weft.zip, or another origin", () => {
    expect(shareUrl("abc")).toBe("https://weft.zip/s/abc");
    expect(shareUrl("abc", "http://localhost:3000")).toBe("http://localhost:3000/s/abc");
  });
});

describe("paneFromUrl", () => {
  it("reads an uploaded page with its anchor", () => {
    expect(paneFromUrl(`blob:sha256:${SHA}#step-2`)).toEqual({ kind: "blob", ref: `blob:sha256:${SHA}`, hash: "#step-2", label: "Page" });
    expect(paneFromUrl(` blob:sha256:${SHA} `)).toMatchObject({ kind: "blob", hash: "" });
  });

  it("refuses a malformed blob ref", () => {
    expect(paneFromUrl("blob:sha256:xyz")).toBeNull();
  });

  it("marks pages only the owner's Mac can reach as local", () => {
    expect(paneFromUrl("http://localhost:3000/settings/")).toEqual({ kind: "local", url: "http://localhost:3000/settings/", label: "localhost:3000/settings" });
    expect(paneFromUrl("http://127.0.0.1:5173")).toMatchObject({ kind: "local" });
    expect(paneFromUrl("file:///Users/me/.weft/show/plan/index.html#a")).toEqual({
      kind: "local",
      url: "file:///Users/me/.weft/show/plan/index.html#a",
      label: "plan/index.html#a",
    });
    expect(paneFromUrl("/Users/me/x.html")).toMatchObject({ kind: "local", label: "me/x.html" });
  });

  it("frames a public site", () => {
    expect(paneFromUrl("https://example.com/docs/")).toEqual({ kind: "site", url: "https://example.com/docs/", label: "example.com/docs" });
  });

  it("ignores empty and unknown strings", () => {
    expect(paneFromUrl("  ")).toBeNull();
    expect(paneFromUrl("about:blank")).toBeNull();
  });
});

describe("paneFor", () => {
  const open = (url: string, at: number): ThreadItem => ({ kind: "tool", id: `t${at}`, name: "mcp__browser__open_url", summary: url, at });
  const user = (page: string | undefined, at: number): ThreadItem => ({ kind: "user", text: "hi", at, ...(page ? { page } : {}) });

  it("takes the newest page from open_url calls and sent messages", () => {
    expect(paneFor([open("https://a.com", 1), user("https://b.com", 3), open("https://c.com", 2)])).toMatchObject({ url: "https://b.com" });
    expect(paneFor([user("https://b.com", 3), open(`blob:sha256:${SHA}`, 5)])).toMatchObject({ kind: "blob" });
  });

  it("lets a later item win a tie", () => {
    expect(paneFor([open("https://a.com", 1), open("https://b.com", 1)])).toMatchObject({ url: "https://b.com" });
  });

  it("skips other tools, pageless messages and unusable urls", () => {
    const other: ThreadItem = { kind: "tool", id: "x", name: "Bash", summary: "https://nope.com", at: 9 };
    expect(paneFor([other, user(undefined, 9), open("about:blank", 9)])).toBeNull();
    expect(paneFor([])).toBeNull();
  });
});

describe("thread addresses", () => {
  it("copies the slug address once there's a slug and a username, else /s/<id>", () => {
    expect(threadPublicUrl("fo", "login")).toBe("https://weft.zip/@fo/threads/login");
    expect(cardShareLink("abc", "login", "fo")).toBe("https://weft.zip/@fo/threads/login");
    expect(cardShareLink("abc", null, "fo")).toBe("https://weft.zip/s/abc");
    expect(cardShareLink("abc", "login", null)).toBe("https://weft.zip/s/abc");
  });
});

describe("seedShareState", () => {
  it("draws the remembered share, a private one without it, or the sign-in", () => {
    expect(seedShareState({ share: { id: "abc", mode: "email", hasPassword: false } }, false)).toEqual({ kind: "ok", id: "abc", url: "https://weft.zip/s/abc", mode: "email", hasPassword: false, slug: null, showChat: true });
    expect(seedShareState({ share: { id: null, mode: "private", hasPassword: false } }, false)).toMatchObject({ url: null });
    expect(seedShareState({}, false)).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, slug: null, showChat: true });
    const memo = { id: "abc", mode: "public" as const, hasPassword: false, url: "https://weft.zip/@fo/threads/x", slug: "x", showChat: false };
    expect(seedShareState({ share: memo }, false)).toMatchObject({ url: "https://weft.zip/@fo/threads/x", slug: "x", showChat: false });
    expect(seedShareState({ share: { id: "abc", mode: "public", hasPassword: false } }, true)).toEqual({ kind: "signed-out" });
  });
});

// electron/browser-pane.cjs: the origin policy the L-5 fix introduces. The helpers are pure
// functions of the (keyed) authorized Map and the call's inputs, so the tests cover the gates
// without standing up the pane's webContentsView.
import { describe, expect, it, vi } from "vitest";
import { authorizeThreadOpen, canThreadOpen, originOf, rememberBoardOrigin } from "./pane-origins.cjs";

describe("canThreadOpen", () => {
  it("allows null-origin URLs (file:, about:)", () => {
    expect(canThreadOpen(new Map(), "k", null, "https://x")).toBe(true);
    expect(canThreadOpen(new Map(), "k", "null", "https://x")).toBe(true);
  });

  it("allows the first load (no prior origin) — board's restore call", () => {
    expect(canThreadOpen(new Map(), "k", "https://x", null)).toBe(true);
  });

  it("allows same-origin navigation", () => {
    expect(canThreadOpen(new Map(), "k", "https://x", "https://x")).toBe(true);
  });

  it("denies a fresh host a thread hasn't been authorized to navigate", () => {
    expect(canThreadOpen(new Map(), "k", "https://other", "https://x")).toBe(false);
  });

  it("allows a host the board explicitly opened", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", "https://other");
    expect(canThreadOpen(auth, "k", "https://other", "https://x")).toBe(true);
  });

  it("scopes authorization per pane key", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "a", "https://other");
    expect(canThreadOpen(auth, "b", "https://other", "https://x")).toBe(false);
  });
});

describe("rememberBoardOrigin", () => {
  it("is a no-op for null origins", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", null);
    rememberBoardOrigin(auth, "k", "null");
    expect(auth.size).toBe(0);
  });

  it("adds the origin to the pane key's set", () => {
    const auth = new Map<string, Set<string>>();
    rememberBoardOrigin(auth, "k", "https://a");
    rememberBoardOrigin(auth, "k", "https://b");
    expect(auth.get("k")?.has("https://a")).toBe(true);
    expect(auth.get("k")?.has("https://b")).toBe(true);
  });
});

describe("originOf", () => {
  it("gives scheme, host and port, \"null\" for file: and null for junk", () => {
    expect(originOf("https://www.google.com/search?q=x")).toBe("https://www.google.com");
    expect(originOf("file:///tmp/a.html")).toBe("null");
    expect(originOf("not a url")).toBe(null);
  });
});

describe("authorizeThreadOpen", () => {
  const call = (ask: (reason: string) => Promise<boolean>, auth = new Map<string, Set<string>>(), pending = new Map()) =>
    authorizeThreadOpen({ authorized: auth, pending, targetKey: "k", origin: "https://www.google.com", priorOrigin: "https://x", ask });

  it("doesn't ask when the host is already allowed", async () => {
    const ask = vi.fn(() => Promise.resolve(true));
    expect(await authorizeThreadOpen({ authorized: new Map(), pending: new Map(), targetKey: "k", origin: "https://x", priorOrigin: "https://x", ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks with the host named, and remembers a yes for that pane", async () => {
    const auth = new Map<string, Set<string>>();
    const ask = vi.fn().mockResolvedValue(true);
    expect(await call(ask, auth)).toBe(true);
    expect(ask).toHaveBeenCalledWith("open www.google.com in a card's browser pane");
    expect(auth.get("k")?.has("https://www.google.com")).toBe(true);
    expect(await call(ask, auth)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("refuses on a no, and asks again next time", async () => {
    const auth = new Map<string, Set<string>>();
    const ask = vi.fn().mockResolvedValue(false);
    expect(await call(ask, auth)).toBe(false);
    expect(auth.size).toBe(0);
    await call(ask, auth);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("treats a failed prompt as a no", async () => {
    expect(await call(vi.fn().mockRejectedValue(new Error("no window")))).toBe(false);
  });

  it("shares one prompt between calls for the same pane and host", async () => {
    let answer: (ok: boolean) => void = () => {};
    const ask = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const auth = new Map<string, Set<string>>();
    const pending = new Map();
    const both = Promise.all([call(ask, auth, pending), call(ask, auth, pending)]);
    await Promise.resolve();
    answer(true);
    expect(await both).toEqual([true, true]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
  });
});

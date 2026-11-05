// @vitest-environment jsdom
// A worker card's page in the native pane (lib/worker-native-page.ts): where it loads, what Save as app saves, and
// when the pane is sent to it.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paneFromUrl } from "@/lib/share-types";
import { nativePageUrl, savedPageUrl, useNativePage } from "./worker-native-page";

interface Shown {
  url: string | null;
  current: string;
}

const SHA = "b".repeat(64);
const ORIGIN = "http://127.0.0.1:4100";
const open = vi.fn<(url: string, key?: string) => Promise<void>>(() => Promise.resolve());

afterEach(() => {
  cleanup();
  open.mockReset();
  open.mockImplementation(() => Promise.resolve());
  Reflect.deleteProperty(window, "weft");
});

describe("nativePageUrl", () => {
  it("frames a page the card wrote through this Mac's server, hash and all", () => {
    expect(nativePageUrl(paneFromUrl(`blob:sha256:${SHA}#s2`), ORIGIN)).toBe(`${ORIGIN}/api/worker-board/page/${SHA}#s2`);
    expect(nativePageUrl(paneFromUrl(`blob:sha256:${SHA}`), ORIGIN)).toBe(`${ORIGIN}/api/worker-board/page/${SHA}`);
  });

  it("reads a teammate's card's page from the team's workspace", () => {
    const org = "0b5c7a4e-1111-4222-8333-944445555666";
    const url = nativePageUrl(paneFromUrl(`blob:sha256:${SHA}#s2`), ORIGIN, org);
    expect(url).toBe(`${ORIGIN}/api/worker-board/page/${SHA}?org=${org}#s2`);
    expect(savedPageUrl(url as string)).toBe(`blob:sha256:${SHA}#s2`);
  });

  it("opens a site as it is, and leaves the rest to the board's pane", () => {
    expect(nativePageUrl(paneFromUrl("https://example.com/x"), ORIGIN)).toBe("https://example.com/x");
    expect(nativePageUrl(paneFromUrl("http://localhost:3000/"), ORIGIN)).toBeNull();
    expect(nativePageUrl(paneFromUrl("weft-screen:ios:iPhone 16"), ORIGIN)).toBeNull();
    expect(nativePageUrl(null, ORIGIN)).toBeNull();
  });
});

describe("savedPageUrl", () => {
  it("turns this Mac's address for a worker page back into its blob ref", () => {
    expect(savedPageUrl(`${ORIGIN}/api/worker-board/page/${SHA}`)).toBe(`blob:sha256:${SHA}`);
    expect(savedPageUrl(`http://localhost:4100/api/worker-board/page/${SHA}#s2`)).toBe(`blob:sha256:${SHA}#s2`);
  });

  it("leaves any other address alone", () => {
    expect(savedPageUrl("https://example.com/")).toBe("https://example.com/");
    expect(savedPageUrl(`https://evil.example/api/worker-board/page/${SHA}`)).toBe(`https://evil.example/api/worker-board/page/${SHA}`);
    expect(savedPageUrl("")).toBe("");
  });
});

describe("useNativePage", () => {
  it("sends the card's pane to a new page, not to the one it already shows, and not back after the user moves on", () => {
    Object.assign(window, { weft: { browser: { open } } });
    const first: Shown = { url: "https://a.example/", current: "" };
    const { rerender } = renderHook(({ url, current }: Shown) => useNativePage("c1", url, current), { initialProps: first });
    expect(open).toHaveBeenCalledWith("https://a.example/", "c1");
    open.mockClear();
    rerender({ url: "https://a.example/", current: "https://elsewhere.example/" });
    expect(open).not.toHaveBeenCalled();
    rerender({ url: "https://b.example/", current: "https://b.example/" });
    expect(open).not.toHaveBeenCalled();
    rerender({ url: null, current: "" });
    expect(open).not.toHaveBeenCalled();
  });

  it("swallows a failed open, and does nothing off the desktop app", async () => {
    Object.assign(window, { weft: { browser: { open } } });
    open.mockImplementation(() => Promise.reject(new Error("gone")));
    renderHook(() => useNativePage("c1", "https://a.example/", ""));
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(window, "weft");
    expect(() => renderHook(() => useNativePage("c2", "https://a.example/", ""))).not.toThrow();
  });
});

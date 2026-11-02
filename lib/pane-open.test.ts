// @vitest-environment jsdom
// Where an open card's panel puts a page (lib/pane-open.ts): this Mac's native pane, or the card's own pane column when
// OpenCard provides one (a worker card's), through an opener that stays the same across renders.
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneOpenContext, usePaneOpen } from "./pane-open";

const browser = { open: vi.fn(() => Promise.resolve()), setVisible: vi.fn() };

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
  vi.clearAllMocks();
});

describe("usePaneOpen", () => {
  it("opens a page in this Mac's native pane for the card, and shows the pane with no page", () => {
    (window as unknown as { weft: unknown }).weft = { browser };
    const { result } = renderHook(() => usePaneOpen("c1"));
    result.current("http://localhost:3000/");
    expect(browser.open).toHaveBeenCalledWith("http://localhost:3000/", "c1");
    result.current();
    expect(browser.setVisible).toHaveBeenCalledWith(true);
  });

  it("swallows a pane that fails to load, and does nothing outside the desktop shell", async () => {
    (window as unknown as { weft: unknown }).weft = { browser: { ...browser, open: vi.fn(() => Promise.reject(new Error("gone"))) } };
    const { result } = renderHook(() => usePaneOpen("c1"));
    result.current("https://x.test/");
    await Promise.resolve();
    delete (window as unknown as { weft?: unknown }).weft;
    expect(() => result.current("https://x.test/")).not.toThrow();
    expect(() => result.current()).not.toThrow();
  });

  it("puts the page in the card's own pane column when there is one, never the native pane, and keeps one opener", () => {
    (window as unknown as { weft: unknown }).weft = { browser };
    let column = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(PaneOpenContext.Provider, { value: column }, children);
    const { result, rerender } = renderHook(() => usePaneOpen("c1"), { wrapper });
    const first = result.current;
    first("https://ling.example.com/");
    expect(column).toHaveBeenCalledWith("https://ling.example.com/");
    first();
    expect(column).toHaveBeenCalledTimes(1);
    // A new closure from the provider is used, through the same opener.
    column = vi.fn();
    rerender();
    expect(result.current).toBe(first);
    first("https://ling.example.com/b");
    expect(column).toHaveBeenCalledWith("https://ling.example.com/b");
    expect(browser.open).not.toHaveBeenCalled();
    expect(browser.setVisible).not.toHaveBeenCalled();
  });
});

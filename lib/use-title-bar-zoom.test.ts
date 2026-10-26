// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge } from "./client";
import { useMacTitleBar, useTitleBarZoom } from "./use-title-bar-zoom";

const zoomVar = () => document.documentElement.style.getPropertyValue("--zoom");

afterEach(() => {
  cleanup();
  delete (window as { weft?: ShellBridge }).weft;
  document.documentElement.style.removeProperty("--zoom");
});

function withZoom(read: () => number) {
  window.weft = { zoomFactor: read } as unknown as ShellBridge;
}

describe("useTitleBarZoom", () => {
  it("does nothing in a plain browser tab", () => {
    renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("");
  });

  it("sets --zoom from the page's zoom and follows it on resize", () => {
    let zoom = 0.75;
    withZoom(() => zoom);
    const { unmount } = renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("0.75");
    zoom = 1.25;
    window.dispatchEvent(new Event("resize"));
    expect(zoomVar()).toBe("1.25");
    unmount();
    zoom = 2;
    window.dispatchEvent(new Event("resize"));
    expect(zoomVar()).toBe("1.25");
  });

  it("falls back to 1 when the zoom reads as 0", () => {
    withZoom(vi.fn(() => 0));
    renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("1");
  });
});

describe("useMacTitleBar", () => {
  it("is false in a plain browser tab", () => {
    expect(renderHook(() => useMacTitleBar()).result.current).toBe(false);
  });

  it("is true in the desktop app on a Mac, and false on other platforms", () => {
    window.weft = { platform: "darwin", zoomFactor: () => 1 } as unknown as ShellBridge;
    expect(renderHook(() => useMacTitleBar()).result.current).toBe(true);
    window.weft = { platform: "win32", zoomFactor: () => 1 } as unknown as ShellBridge;
    expect(renderHook(() => useMacTitleBar()).result.current).toBe(false);
  });
});

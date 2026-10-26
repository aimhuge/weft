// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
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

  it("reads the zoom again on every resize", () => {
    const read = vi.fn(() => 1);
    withZoom(read);
    renderHook(() => useTitleBarZoom());
    expect(read).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("resize"));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the shell has no zoomFactor", () => {
    window.weft = {} as unknown as ShellBridge;
    renderHook(() => useTitleBarZoom());
    expect(zoomVar()).toBe("");
  });

  it("removes its resize listener on unmount", () => {
    withZoom(() => 1);
    const { unmount } = renderHook(() => useTitleBarZoom());
    unmount();
    // The listener is gone, so a later resize changes nothing.
    document.documentElement.style.setProperty("--zoom", "9");
    window.dispatchEvent(new Event("resize"));
    expect(zoomVar()).toBe("9");
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

  it("is false during server render, where there is no bridge to read", () => {
    // The server snapshot is what React renders with: no platform, so no mac title bar.
    window.weft = { platform: "darwin", zoomFactor: () => 1 } as unknown as ShellBridge;
    let seen: boolean | undefined;
    function Probe() {
      seen = useMacTitleBar();
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen).toBe(false);
  });
});

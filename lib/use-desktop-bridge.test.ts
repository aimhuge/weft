// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserState, ShellBridge } from "./client";
import type { Card, Column } from "./types";
import { useDesktopBridge } from "./use-desktop-bridge";

const closed: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};
const open: BrowserState = { ...closed, visible: true, url: "http://localhost:3000", title: "App" };

function card(id: string, column: Column = "running"): Card {
  return { id, column } as Card;
}

// The parts of window.weft (electron/preload.cjs) the hook touches, with handles to drive them.
function installBridge(platform = "darwin", state: BrowserState = open, extra: Record<string, unknown> = {}) {
  let browserListener: ((s: BrowserState) => void) | undefined;
  let copilotListener: ((s: { open: boolean }) => void) | undefined;
  const offBrowser = vi.fn();
  const offCopilot = vi.fn();
  const bridge = {
    desktop: true,
    platform,
    browser: {
      getState: vi.fn(() => Promise.resolve(state)),
      onState: vi.fn((cb: (s: BrowserState) => void) => {
        browserListener = cb;
        return offBrowser;
      }),
      setActive: vi.fn(),
      prune: vi.fn(),
    },
    copilot: {
      onState: vi.fn((cb: (s: { open: boolean }) => void) => {
        copilotListener = cb;
        return offCopilot;
      }),
    },
    setBadge: vi.fn(),
    ...extra,
  };
  window.weft = bridge as unknown as ShellBridge;
  return {
    bridge,
    offBrowser,
    offCopilot,
    emitBrowser: (s: BrowserState) => browserListener?.(s),
    emitCopilot: (s: { open: boolean }) => copilotListener?.(s),
  };
}

afterEach(() => {
  cleanup();
  delete window.weft;
});

describe("useDesktopBridge in a plain browser tab", () => {
  it("reports no desktop, no mac, the closed browser and no copilot", () => {
    const { result } = renderHook(() => useDesktopBridge(closed, "c1", [card("c1", "needs_you")]));
    expect(result.current).toEqual({ desktop: false, mac: false, browser: closed, copilotOpen: false });
  });

  it("reads false for desktop and mac during server render", () => {
    installBridge();
    let seen: ReturnType<typeof useDesktopBridge> | undefined;
    function Probe() {
      seen = useDesktopBridge(closed, null, []);
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen).toMatchObject({ desktop: false, mac: false });
  });
});

describe("useDesktopBridge in the desktop app", () => {
  it("reports desktop and mac on darwin", () => {
    installBridge("darwin");
    const { result } = renderHook(() => useDesktopBridge(closed, null, []));
    expect(result.current.desktop).toBe(true);
    expect(result.current.mac).toBe(true);
  });

  it("isn't mac on other platforms", () => {
    installBridge("linux");
    const { result } = renderHook(() => useDesktopBridge(closed, null, []));
    expect(result.current.desktop).toBe(true);
    expect(result.current.mac).toBe(false);
  });

  it("loads the browser pane's state on mount and follows its updates", async () => {
    const { bridge, emitBrowser } = installBridge();
    const { result } = renderHook(() => useDesktopBridge(closed, null, []));
    expect(bridge.browser.getState).toHaveBeenCalledOnce();
    await act(async () => {});
    expect(result.current.browser).toEqual(open);
    const loading = { ...open, loading: true };
    act(() => emitBrowser(loading));
    expect(result.current.browser).toEqual(loading);
  });

  it("follows the copilot window opening and closing", () => {
    const { emitCopilot } = installBridge();
    const { result } = renderHook(() => useDesktopBridge(closed, null, []));
    act(() => emitCopilot({ open: true }));
    expect(result.current.copilotOpen).toBe(true);
    act(() => emitCopilot({ open: false }));
    expect(result.current.copilotOpen).toBe(false);
  });

  it("tells the desktop app the dictation key on mount", () => {
    localStorage.clear();
    const setShortcut = vi.fn();
    installBridge("darwin", open, { dictation: { setShortcut } });
    renderHook(() => useDesktopBridge(closed, null, []));
    expect(setShortcut).toHaveBeenCalledExactlyOnceWith("Alt+'");
  });

  it("unsubscribes from both listeners on unmount", () => {
    const { offBrowser, offCopilot } = installBridge();
    const { unmount } = renderHook(() => useDesktopBridge(closed, null, []));
    unmount();
    expect(offBrowser).toHaveBeenCalledOnce();
    expect(offCopilot).toHaveBeenCalledOnce();
  });

  it("shows the selected card's browser, or the board's own with none selected", () => {
    const { bridge } = installBridge();
    const initialProps: { id: string | null } = { id: "c1" };
    const { rerender } = renderHook(({ id }) => useDesktopBridge(closed, id, []), { initialProps });
    expect(bridge.browser.setActive).toHaveBeenLastCalledWith("c1");
    rerender({ id: null });
    expect(bridge.browser.setActive).toHaveBeenLastCalledWith(null);
    expect(bridge.browser.setActive).toHaveBeenCalledTimes(2);
  });

  it("closes the browsers of cards that are gone", () => {
    const { bridge } = installBridge();
    const { rerender } = renderHook(({ cards }) => useDesktopBridge(closed, null, cards), {
      initialProps: { cards: [card("a"), card("b")] },
    });
    expect(bridge.browser.prune).toHaveBeenLastCalledWith(["a", "b", "copilot"]);
    rerender({ cards: [card("b")] });
    expect(bridge.browser.prune).toHaveBeenLastCalledWith(["b", "copilot"]);
  });

  it("doesn't prune while the board has no cards (still loading)", () => {
    const { bridge } = installBridge();
    renderHook(() => useDesktopBridge(closed, null, []));
    expect(bridge.browser.prune).not.toHaveBeenCalled();
  });

  it("badges the dock with how many cards need you", () => {
    const { bridge } = installBridge();
    const { rerender } = renderHook(({ cards }) => useDesktopBridge(closed, null, cards), {
      initialProps: { cards: [card("a", "needs_you"), card("b", "running"), card("c", "needs_you")] },
    });
    expect(bridge.setBadge).toHaveBeenLastCalledWith(2);
    rerender({ cards: [] });
    expect(bridge.setBadge).toHaveBeenLastCalledWith(0);
  });
});

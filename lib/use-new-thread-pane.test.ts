// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import type { BrowserState, ShellBridge } from "./client";

const mocks = vi.hoisted(() => ({ newThreadPage: vi.fn() }));
vi.mock("./client", () => ({ api: { newThreadPage: mocks.newThreadPage } }));

import { NEW_THREAD_PANE, useNewThreadPane } from "./use-new-thread-pane";
import { loadSeenIntros, markIntroSeen } from "./feature-intros";

// The splash is what shows once the intro has played; the intro's own case clears this.
beforeEach(() => {
  localStorage.clear();
  markIntroSeen("newthread");
});

afterEach(() => {
  cleanup();
  delete window.weft;
  vi.clearAllMocks();
});

const CLOSED: BrowserState = {
  visible: false,
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 100,
};

function installBridge(over: Partial<ShellBridge["browser"]> = {}) {
  const browser = {
    open: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn(),
    prune: vi.fn(),
    getState: vi.fn().mockResolvedValue(CLOSED),
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    zoom: vi.fn(),
    onState: vi.fn().mockReturnValue(() => {}),
    ...over,
  };
  window.weft = { desktop: true, browser } as unknown as ShellBridge;
  return browser;
}

// Let the hook's promise chain (page fetch, open, Promise.all in cleanup) flush.
const flush = () => new Promise((r) => setTimeout(r, 0));

// The hook reads selectedRef.current at cleanup, so the ref needs its value set, not just constructed.
const refOf = (id: string | null): RefObject<string | null> => ({ current: id });

describe("useNewThreadPane", () => {
  it("does nothing while the dialog is closed", async () => {
    const browser = installBridge();
    const { unmount } = renderHook(() => useNewThreadPane(false, refOf(null)));
    await flush();
    unmount();
    expect(mocks.newThreadPage).not.toHaveBeenCalled();
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("does nothing outside the desktop app", async () => {
    const { unmount } = renderHook(() => useNewThreadPane(true, refOf(null)));
    await flush();
    unmount();
    expect(mocks.newThreadPage).not.toHaveBeenCalled();
  });

  it("opens the splash page in the pane beside the dialog", async () => {
    const browser = installBridge();
    mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
    const { unmount } = renderHook(() => useNewThreadPane(true, refOf("c1")));
    await flush();
    expect(mocks.newThreadPage).toHaveBeenCalledTimes(1);
    expect(browser.open).toHaveBeenCalledWith("file:///new-thread.html", NEW_THREAD_PANE);
    unmount();
  });

  it("plays the intro in the same pane instead of the splash the first time", async () => {
    localStorage.clear();
    const browser = installBridge();
    const { unmount } = renderHook(() => useNewThreadPane(true, refOf(null)));
    await flush();
    expect(mocks.newThreadPage).not.toHaveBeenCalled();
    expect(browser.open).toHaveBeenCalledWith(`${window.location.origin}/intros/newthread.html?live=1`, NEW_THREAD_PANE);
    expect(loadSeenIntros().has("newthread")).toBe(true);
    unmount();
  });

  it("on close restores the active card's browser, leaving visibility alone", async () => {
    const browser = installBridge();
    mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
    const ref = refOf("c1");
    const { unmount } = renderHook(() => useNewThreadPane(true, ref));
    await flush();
    unmount();
    await flush();
    expect(browser.setActive).toHaveBeenCalledWith("c1");
    expect(browser.setVisible).not.toHaveBeenCalled();
  });

  it("on close with no card open restores the pane's prior visibility", async () => {
    const browser = installBridge({ getState: vi.fn().mockResolvedValue({ ...CLOSED, visible: true }) });
    mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
    const { unmount } = renderHook(() => useNewThreadPane(true, refOf(null)));
    await flush();
    unmount();
    await flush();
    expect(browser.setActive).toHaveBeenCalledWith(null);
    expect(browser.setVisible).toHaveBeenCalledWith(true);
  });

  it("swallows a failed splash-page fetch", async () => {
    const browser = installBridge();
    mocks.newThreadPage.mockRejectedValue(new Error("no page"));
    const { unmount } = renderHook(() => useNewThreadPane(true, refOf("c1")));
    await flush();
    expect(browser.open).not.toHaveBeenCalled();
    unmount();
    await flush();
    expect(browser.setActive).toHaveBeenCalledWith("c1");
  });

  describe("holds the board pane's visibility through the close", () => {
    const pane = (showNew: boolean, visible: boolean) => ({ showNew, visible });

    it("returns null while the dialog is open or was never opened", () => {
      installBridge();
      const { result, rerender } = renderHook(({ showNew, visible }) => useNewThreadPane(showNew, refOf(null), visible), { initialProps: pane(false, false) });
      expect(result.current).toBeNull();
      rerender(pane(true, false));
      expect(result.current).toBeNull();
    });

    it("on close returns the prior visibility until the pane's state catches up", async () => {
      installBridge();
      mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
      const { result, rerender } = renderHook(({ showNew, visible }) => useNewThreadPane(showNew, refOf(null), visible), { initialProps: pane(false, false) });
      rerender(pane(true, false));
      // The splash opened the pane.
      rerender(pane(true, true));
      rerender(pane(false, true));
      expect(result.current).toBe(false);
      await flush();
      // The restore landed: setVisible(false) came back as state.
      rerender(pane(false, false));
      expect(result.current).toBeNull();
    });

    it("lets go once a card is open, whose own pane takes over", async () => {
      installBridge();
      mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
      const ref = refOf(null);
      const { result, rerender } = renderHook(({ showNew, visible }) => useNewThreadPane(showNew, ref, visible), { initialProps: pane(true, false) });
      rerender(pane(true, true));
      ref.current = "c1";
      rerender(pane(false, true));
      await act(flush);
      expect(result.current).toBeNull();
    });

    it("lets go when the restore fails", async () => {
      installBridge({ getState: vi.fn().mockRejectedValue(new Error("gone")) });
      mocks.newThreadPage.mockResolvedValue({ url: "file:///new-thread.html" });
      const { result, rerender } = renderHook(({ showNew, visible }) => useNewThreadPane(showNew, refOf(null), visible), { initialProps: pane(true, false) });
      rerender(pane(true, true));
      rerender(pane(false, true));
      await act(flush);
      expect(result.current).toBeNull();
    });
  });
});

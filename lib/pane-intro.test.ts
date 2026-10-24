// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSeenIntros, markIntroSeen } from "./feature-intros";
import { hasPane, paneIntroUrl, usePaneIntro } from "./pane-intro";

const openInPane = vi.hoisted(() => vi.fn());
vi.mock("./open-in-pane", () => ({ openInPane }));

const intro = `${window.location.origin}/intros/newthread.html?live=1`;

describe("usePaneIntro", () => {
  beforeEach(() => {
    localStorage.clear();
    openInPane.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens the intro in the pane the first time, once, and marks it seen", () => {
    const { rerender } = renderHook(() => usePaneIntro("newthread"));
    rerender();
    expect(openInPane).toHaveBeenCalledTimes(1);
    expect(openInPane).toHaveBeenCalledWith(intro);
    expect(loadSeenIntros().has("newthread")).toBe(true);
    renderHook(() => usePaneIntro("newthread"));
    expect(openInPane).toHaveBeenCalledTimes(1);
  });

  it("stays shut once seen, for reduced motion, and with no intro", () => {
    markIntroSeen("newthread");
    renderHook(() => usePaneIntro("newthread"));
    localStorage.clear();
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    renderHook(() => usePaneIntro("newthread"));
    expect(renderHook(() => usePaneIntro(null)).result.current).toBeNull();
    expect(openInPane).not.toHaveBeenCalled();
  });

  it("plays it again on ▶", () => {
    markIntroSeen("newthread");
    renderHook(() => usePaneIntro("newthread")).result.current!();
    expect(openInPane).toHaveBeenCalledWith(intro);
  });
});

describe("hasPane and paneIntroUrl", () => {
  afterEach(() => {
    delete (window as { weft?: unknown }).weft;
  });

  it("finds the desktop's pane bridge, and nothing on the web", () => {
    expect(hasPane()).toBe(false);
    (window as { weft?: unknown }).weft = { browser: { open: () => Promise.resolve() } };
    expect(hasPane()).toBe(true);
  });

  it("puts the intro on Weft's own origin", () => {
    expect(paneIntroUrl("newthread", "http://localhost:3000")).toBe("http://localhost:3000/intros/newthread.html?live=1");
  });
});

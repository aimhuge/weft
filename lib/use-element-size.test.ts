// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementSize } from "./use-element-size";

afterEach(() => vi.unstubAllGlobals());

// A ResizeObserver stand-in that hands back its callback so a test can say "it resized".
function stubObserver() {
  const seen = { callback: () => {}, disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        seen.callback = callback;
      }
      observe() {}
      disconnect = seen.disconnect;
    },
  );
  return seen;
}

const box = (width: number, height: number) => {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => height });
  return { el, resize: (w: number, h: number) => ((width = w), (height = h)) };
};

describe("useElementSize", () => {
  it("measures on mount, follows resizes, and stops watching on unmount", () => {
    const observer = stubObserver();
    const { el, resize } = box(800, 600);
    const { result, unmount } = renderHook(() => useElementSize({ current: el }));
    expect(result.current).toEqual({ width: 800, height: 600 });
    const before = result.current;
    act(() => observer.callback());
    expect(result.current).toBe(before);
    resize(1200, 700);
    act(() => observer.callback());
    expect(result.current).toEqual({ width: 1200, height: 700 });
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("stays 0 x 0 with no element, or where ResizeObserver doesn't exist", () => {
    expect(renderHook(() => useElementSize({ current: null })).result.current).toEqual({ width: 0, height: 0 });
    vi.stubGlobal("ResizeObserver", undefined);
    const { el } = box(800, 600);
    expect(renderHook(() => useElementSize({ current: el })).result.current).toEqual({ width: 0, height: 0 });
  });
});

// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_FOCUS_KEY } from "./focus-trigger";
import { useFocusTrigger } from "./use-focus-trigger";

const HOUR = 60 * 60 * 1000;

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFocusTrigger", () => {
  it("fires when the app is focused after four hours away", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a shorter absence", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - HOUR) });
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).not.toHaveBeenCalled();
  });

  it("fires once per absence, not once per focus event", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    act(() => window.dispatchEvent(new Event("focus")));
    // Alt-tab away and back a minute later: the absence already ended, so nothing fires again.
    vi.setSystemTime(new Date(Date.now() + 60_000));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).toHaveBeenCalledTimes(1);
  });

  it("never fires on the first focus of a fresh install", () => {
    const store = memory();
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).not.toHaveBeenCalled();
  });

  it("fires when the app comes back from hidden, as on macOS", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    // The window was hidden and is visible again.
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(onWelcomeBack).toHaveBeenCalledTimes(1);
  });

  it("doesn't fire when the app is hidden: leaving isn't coming back", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(onWelcomeBack).not.toHaveBeenCalled();
  });

  it("does nothing without storage (the server)", () => {
    const onWelcomeBack = vi.fn();
    renderHook(() => useFocusTrigger(onWelcomeBack));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).not.toHaveBeenCalled();
  });

  it("calls the callback it was given now, not the one it mounted with", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useFocusTrigger(cb, { storage: store }), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    act(() => window.dispatchEvent(new Event("focus")));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it goes away", () => {
    const store = memory({ [LAST_FOCUS_KEY]: String(Date.now() - 5 * HOUR) });
    const onWelcomeBack = vi.fn();
    const { unmount } = renderHook(() => useFocusTrigger(onWelcomeBack, { storage: store }));
    unmount();

    act(() => window.dispatchEvent(new Event("focus")));
    expect(onWelcomeBack).not.toHaveBeenCalled();
  });
});

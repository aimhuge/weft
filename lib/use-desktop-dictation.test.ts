// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PillUpdate, ShellBridge } from "./client";
import { useDesktopDictation } from "./use-desktop-dictation";

type Bridge = NonNullable<ShellBridge["dictation"]>;

function local() {
  return { state: "idle" as const, error: "local error", seconds: 9, level: 0.4, toggle: vi.fn(), cancel: vi.fn(), clearError: vi.fn() };
}

let listener: ((update: PillUpdate) => void) | null;
let bridge: { [K in keyof Bridge]: ReturnType<typeof vi.fn> };
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  listener = null;
  bridge = {
    toggle: vi.fn(),
    cancel: vi.fn(),
    setShortcut: vi.fn(),
    onState: vi.fn((cb: (update: PillUpdate) => void) => {
      listener = cb;
      return unsubscribe;
    }),
  };
});

afterEach(() => {
  delete window.weft;
});

function withBridge() {
  window.weft = { dictation: bridge } as unknown as ShellBridge;
}

function update(next: PillUpdate | null) {
  act(() => listener!(next as PillUpdate));
}

describe("useDesktopDictation", () => {
  it("returns the local recorder as is in a browser tab", () => {
    const mine = local();
    const { result } = renderHook(() => useDesktopDictation(mine, vi.fn()));
    expect(result.current).toBe(mine);
  });

  it("returns the local recorder in a shell without dictation", () => {
    window.weft = {} as ShellBridge;
    const mine = local();
    const { result } = renderHook(() => useDesktopDictation(mine, vi.fn()));
    expect(result.current).toBe(mine);
  });

  it("starts idle with the desktop bridge", () => {
    withBridge();
    const { result } = renderHook(() => useDesktopDictation(local(), vi.fn()));
    expect(result.current).toMatchObject({ state: "idle", seconds: 0, level: 0, error: null });
  });

  it("follows the pill's state, and a null update is idle", () => {
    withBridge();
    const { result } = renderHook(() => useDesktopDictation(local(), vi.fn()));
    update({ state: "recording", seconds: 4, level: 0.7 });
    expect(result.current).toMatchObject({ state: "recording", seconds: 4, level: 0.7, error: null });
    update(null);
    expect(result.current).toMatchObject({ state: "idle", seconds: 0, level: 0 });
  });

  it("puts the caret back before starting at idle", () => {
    withBridge();
    const order: string[] = [];
    const focus = vi.fn(() => order.push("focus"));
    bridge.toggle.mockImplementation(() => order.push("toggle"));
    const { result } = renderHook(() => useDesktopDictation(local(), focus));
    result.current.toggle();
    expect(order).toEqual(["focus", "toggle"]);
  });

  it("doesn't move the caret when stopping a recording", () => {
    withBridge();
    const focus = vi.fn();
    const { result } = renderHook(() => useDesktopDictation(local(), focus));
    update({ state: "recording", seconds: 1, level: 0 });
    result.current.toggle();
    expect(focus).not.toHaveBeenCalled();
    expect(bridge.toggle).toHaveBeenCalledTimes(1);
  });

  it("cancels through the bridge, and clearError does nothing", () => {
    withBridge();
    const mine = local();
    const { result } = renderHook(() => useDesktopDictation(mine, vi.fn()));
    result.current.cancel();
    expect(bridge.cancel).toHaveBeenCalledTimes(1);
    expect(() => result.current.clearError()).not.toThrow();
    expect(mine.clearError).not.toHaveBeenCalled();
    expect(mine.cancel).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    withBridge();
    const { unmount } = renderHook(() => useDesktopDictation(local(), vi.fn()));
    expect(bridge.onState).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders on the server as the local recorder", () => {
    withBridge();
    const mine = local();
    let seen: unknown;
    function Probe() {
      seen = useDesktopDictation(mine, () => {});
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen).toBe(mine);
  });
});

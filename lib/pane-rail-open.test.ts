// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { railOpen, setRailOpen, subscribeRail, toggleRail, useRailOpen } from "./pane-rail-open";

afterEach(() => setRailOpen(false));

describe("pane-rail-open", () => {
  it("starts folded and toggles open and shut", () => {
    expect(railOpen()).toBe(false);
    toggleRail();
    expect(railOpen()).toBe(true);
    toggleRail();
    expect(railOpen()).toBe(false);
  });

  it("tells listeners only on a real change, until they unsubscribe", () => {
    const listener = vi.fn();
    const stop = subscribeRail(listener);
    setRailOpen(false);
    expect(listener).not.toHaveBeenCalled();
    setRailOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setRailOpen(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-renders a component that reads it", () => {
    const { result } = renderHook(() => useRailOpen());
    expect(result.current).toBe(false);
    act(() => toggleRail());
    expect(result.current).toBe(true);
  });
});

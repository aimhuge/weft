// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PHONE_MAX_WIDTH, usePhoneWidth } from "./use-phone-width";

afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

function media(matches: boolean) {
  const listeners = new Set<() => void>();
  const list = { matches, addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (q: string) => (q.includes(String(PHONE_MAX_WIDTH)) ? list : null) });
  return { list, listeners };
}

describe("usePhoneWidth", () => {
  it("is false where the browser has no media queries", () => {
    expect(renderHook(() => usePhoneWidth()).result.current).toBe(false);
  });

  it("follows the window across 768px", () => {
    const { list, listeners } = media(false);
    const { result, unmount } = renderHook(() => usePhoneWidth());
    expect(result.current).toBe(false);
    list.matches = true;
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

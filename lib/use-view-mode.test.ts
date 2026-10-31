// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setBoardMode, setViewMode, viewMode } from "./board-prefs";
import { useRegularMode } from "./use-regular-mode";
import { useViewMode } from "./use-view-mode";

afterEach(() => {
  cleanup();
  document.cookie = "weft-board-mode=; path=/; max-age=0";
  document.cookie = "weft-view-mode=; path=/; max-age=0";
});

describe("useViewMode", () => {
  it("reads and chooses the saved view in Advanced", () => {
    const { result } = renderHook(() => useViewMode());
    act(() => result.current.choose("list"));
    expect(result.current.mode).toBe("list");
  });

  it("is always the board in Regular, and keeps a saved list view for Advanced", () => {
    setViewMode("list");
    setBoardMode("regular");
    const { result } = renderHook(() => useViewMode());
    expect(result.current.mode).toBe("board");
    act(() => result.current.choose("list"));
    expect(result.current.mode).toBe("board");
    act(() => setBoardMode("advanced"));
    expect(result.current.mode).toBe("list");
    expect(viewMode()).toBe("list");
  });
});

describe("useRegularMode", () => {
  it("follows the mode live", () => {
    const { result } = renderHook(() => useRegularMode());
    expect(result.current).toBe(false);
    act(() => setBoardMode("regular"));
    expect(result.current).toBe(true);
  });
});

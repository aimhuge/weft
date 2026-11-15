// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setBoardMode } from "./board-prefs";
import { setSimplePiece } from "./simple-mode";
import { useOneBox } from "./use-one-box";

afterEach(() => {
  setSimplePiece("one-box-new-card", undefined);
  document.cookie = "weft-board-mode=; path=/; max-age=0";
});

describe("useOneBox", () => {
  it("shows every control when the piece is off", () => {
    setSimplePiece("one-box-new-card", false);
    expect(renderHook(() => useOneBox()).result.current.full).toBe(true);
  });

  it("hides the controls when the piece is on, until showAll", () => {
    setSimplePiece("one-box-new-card", true);
    const { result } = renderHook(() => useOneBox());
    expect(result.current.full).toBe(false);
    act(() => result.current.showAll());
    expect(result.current.full).toBe(true);
  });

  it("follows the mode when the piece has no setting of its own: one-box in regular, full in advanced", () => {
    setBoardMode("regular");
    expect(renderHook(() => useOneBox()).result.current.full).toBe(false);
    setBoardMode("advanced");
    expect(renderHook(() => useOneBox()).result.current.full).toBe(true);
  });
});

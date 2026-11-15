// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSurfaceMode } from "./use-board-sidebar";

const piece = (on: boolean) => (document.cookie = `weft-simple-three-piles=${on ? 1 : 0}; path=/`);

afterEach(() => {
  document.cookie = "weft-simple-three-piles=; path=/; max-age=0";
});

describe("useSurfaceMode", () => {
  it("draws the board as the sidebar with the three piles on", () => {
    piece(true);
    expect(renderHook(() => useSurfaceMode("board")).result.current).toBe("sidebar");
  });

  it("keeps the list view, and the board with the piece off", () => {
    piece(true);
    expect(renderHook(() => useSurfaceMode("list")).result.current).toBe("list");
    piece(false);
    expect(renderHook(() => useSurfaceMode("board")).result.current).toBe("board");
  });
});

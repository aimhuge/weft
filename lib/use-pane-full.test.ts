// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setRailOpen, setThreadShown } from "./pane-rail-open";
import { usePaneFull } from "./use-pane-full";

const piece = vi.hoisted(() => ({ on: true }));
vi.mock("./use-simple-piece", () => ({ useSimplePiece: () => piece.on }));

afterEach(() => {
  act(() => {
    setRailOpen(false);
    setThreadShown(false);
  });
  piece.on = true;
});

describe("usePaneFull", () => {
  it("hides the show and thread columns, then only the show column once the thread opens", () => {
    const { result } = renderHook(() => usePaneFull(true, true));
    expect(result.current).toEqual({ full: true, rail: false, thread: false, hidden: ["show", "thread"] });
    act(() => {
      setThreadShown(true);
      setRailOpen(true);
    });
    expect(result.current).toEqual({ full: true, rail: true, thread: true, hidden: ["show"] });
  });

  it("is off with the piece off, off this Mac's pane, or with the pane column closed", () => {
    act(() => setRailOpen(true));
    for (const [on, canPane, paneOpen] of [[false, true, true], [true, false, true], [true, true, false]] as const) {
      piece.on = on;
      const { result } = renderHook(() => usePaneFull(canPane, paneOpen));
      expect(result.current).toMatchObject({ full: false, rail: false, hidden: undefined });
    }
  });
});

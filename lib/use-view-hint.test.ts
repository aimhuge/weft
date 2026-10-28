// @vitest-environment happy-dom
// The pane that says where Escape just took you: it appears on a flip, counts the flips so it can
// restart its timer, and closes itself after a moment.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintText, useViewHint, viewLabel } from "./use-view-hint";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useViewHint", () => {
  it("starts with no hint", () => {
    const { result } = renderHook(() => useViewHint());
    expect(result.current.hint).toBeNull();
  });

  it("shows the view it was given", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    expect(result.current.hint).toMatchObject({ mode: "list" });
  });

  it("counts the flips, so a second flip is a new hint", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    const first = result.current.hint?.id;
    act(() => result.current.show("board"));
    expect(result.current.hint?.id).not.toBe(first);
    expect(result.current.hint?.mode).toBe("board");
  });

  it("closes itself after a moment", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    void act(() => vi.advanceTimersByTime(3000));
    expect(result.current.hint).toBeNull();
  });

  it("restarts its timer on a second flip", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    void act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.show("board"));
    void act(() => vi.advanceTimersByTime(2000));
    expect(result.current.hint).toMatchObject({ mode: "board" });
    void act(() => vi.advanceTimersByTime(1000));
    expect(result.current.hint).toBeNull();
  });

  it("clears on demand", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    act(() => result.current.clear());
    expect(result.current.hint).toBeNull();
  });
});

describe("the hint's words", () => {
  it("names the view and says Escape goes back", () => {
    expect(hintText("list")).toContain("List");
    expect(hintText("board")).toContain("Board");
    expect(hintText("list")).toContain("Esc");
  });

  it("labels the two views", () => {
    expect(viewLabel("board")).toBe("Board");
    expect(viewLabel("list")).toBe("List");
  });
});

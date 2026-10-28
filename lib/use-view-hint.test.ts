// @vitest-environment happy-dom
// The pane that says where Escape just took you: it appears on a flip, counts the flips so it can
// restart its timer, and closes itself after a moment.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintOther, hintOtherText, hintText, hintTitle, useViewHint, viewLabel } from "./use-view-hint";

// The pane's own lifetime, so a test doesn't have to guess it.
const HINT_MS = 4000;

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
    void act(() => vi.advanceTimersByTime(HINT_MS + 100));
    expect(result.current.hint).toBeNull();
  });

  it("restarts its timer on a second flip", () => {
    const { result } = renderHook(() => useViewHint());
    act(() => result.current.show("list"));
    void act(() => vi.advanceTimersByTime(HINT_MS - 1000));
    act(() => result.current.show("board"));
    void act(() => vi.advanceTimersByTime(HINT_MS - 1000));
    expect(result.current.hint).toMatchObject({ mode: "board" });
    void act(() => vi.advanceTimersByTime(1100));
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

  it("has a title of its own, so the pane can set it in accent", () => {
    expect(hintTitle("list")).toBe("List view");
    expect(hintTitle("board")).toBe("Board view");
  });

  it("names the view the next Escape would take you to", () => {
    expect(hintOther("list")).toBe("Board");
    expect(hintOther("board")).toBe("List");
  });

  it("says what the next Escape does, in one sentence", () => {
    expect(hintOtherText("list")).toBe("hit Esc again to switch to board view");
    expect(hintOtherText("board")).toBe("hit Esc again to switch to list view");
  });
});

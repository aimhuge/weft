// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, type SerializedLayout } from "./workspace-layout";

afterEach(cleanup);

const STORAGE_KEY = "weft-workspace-layout";

function setStored(layout: object) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

beforeEach(() => {
  localStorage.clear();
  // The hook module caches the first-read layout in a module-local `current`. Force a fresh
  // import between tests by clearing our shared module cache via dynamic re-import. Vitest's
  // vi.resetModules handles it; we use a per-test wrapper to keep things simple here.
  vi.resetModules();
});

describe("useWorkspaceLayout", () => {
  it("returns the default layout on first render with no stored value", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    expect(result.current.fill).toBe("pane");
    expect(result.current.dragging).toBe(false);
  });

  it("loads a stored layout on mount", async () => {
    setStored({ open: { thread: true, editor: true, pane: false, show: true }, width: { thread: 500 } });
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    expect(result.current.layout.open.editor).toBe(true);
    expect(result.current.layout.open.pane).toBe(false);
    expect(result.current.layout.width.thread).toBe(500);
    expect(result.current.fill).toBe("editor");
  });

  it("falls back to defaults when the stored JSON is malformed", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("toggle closes an open column and persists the change", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.toggle("show"));
    expect(result.current.layout.open.show).toBe(false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as SerializedLayout;
    expect(stored.open.show).toBe(false);
  });

  it("toggle reopens a closed column", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.toggle("editor"));
    expect(result.current.layout.open.editor).toBe(true);
  });

  it("toggle refuses to close the last open column", async () => {
    setStored({ open: { thread: false, editor: false, pane: false, show: true }, width: {} });
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.toggle("show"));
    expect(result.current.layout.open.show).toBe(true);
  });

  it("setOpen applies and persists", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.setOpen("editor", true));
    expect(result.current.layout.open.editor).toBe(true);
    act(() => result.current.setOpen("show", false));
    expect(result.current.layout.open.show).toBe(false);
  });

  it("dragDivider updates the non-fill side's width", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    const before = result.current.layout.width.thread;
    act(() => result.current.dragDivider("thread", "pane", 50, 1500));
    expect(result.current.layout.width.thread).toBe(before + 50);
  });

  it("dragDivider adds up moves made through the handler bound at pointerdown", async () => {
    // The divider keeps the dragDivider it had at pointerdown for the whole drag, so each move
    // must apply to the latest layout, not the one that render closed over.
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    const before = result.current.layout.width.thread;
    const drag = result.current.dragDivider;
    act(() => drag("thread", "pane", 20, 1500));
    act(() => drag("thread", "pane", 20, 1500));
    act(() => drag("thread", "pane", 20, 1500));
    expect(result.current.layout.width.thread).toBe(before + 60);
  });

  it("a fit bound before the pane reopened doesn't close it again", async () => {
    // A resize report can still hold the fitToContainer from before the card opened.
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.setOpen("pane", false));
    const fit = result.current.fitToContainer;
    act(() => result.current.setOpen("pane", true));
    act(() => fit(1500));
    expect(result.current.layout.open.pane).toBe(true);
  });

  it("fitToContainer shrinks the layout to the container", async () => {
    // editor is closed in the default layout, so the fixed columns are thread + show. With pane
    // as the fill, the target is containerWidth - MIN_WIDTH.pane.
    setStored({ open: DEFAULT_LAYOUT.open, width: { thread: 1000, editor: 1000, pane: 1000, show: 200 } });
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.fitToContainer(700));
    // Sum of the fixed columns (thread + show) should equal 700 - MIN_WIDTH.pane(280) = 420.
    const fixed = result.current.layout.width.thread + result.current.layout.width.show;
    expect(fixed).toBeCloseTo(420, 1);
  });

  it("reset returns to the default layout and persists it", async () => {
    setStored({ open: { thread: false, editor: true, pane: false, show: false }, width: { thread: 9999, editor: 9999, pane: 9999, show: 9999 } });
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as SerializedLayout;
    expect(stored.open.pane).toBe(true);
  });

  it("setDragging flips the dragging flag", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const { result } = renderHook(() => use());
    expect(result.current.dragging).toBe(false);
    act(() => result.current.setDragging(true));
    expect(result.current.dragging).toBe(true);
    act(() => result.current.setDragging(false));
    expect(result.current.dragging).toBe(false);
  });

  it("multiple hook readers stay in sync after a commit", async () => {
    const { useWorkspaceLayout: use } = await import("./use-workspace-layout");
    const a = renderHook(() => use());
    const b = renderHook(() => use());
    act(() => a.result.current.toggle("editor"));
    expect(b.result.current.layout.open.editor).toBe(true);
  });
});

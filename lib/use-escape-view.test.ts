// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardMode, setBoardMode, setViewMode, viewMode } from "./board-prefs";
import { useEscape } from "./use-escape";
import { useEscapeTogglesView, type BoardLayers } from "./use-escape-view";
import { currentStop } from "./view-stops";

const bare: BoardLayers = { thread: false, newThread: false, browser: false, drawer: false };

function press(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  for (const name of ["weft-board-mode", "weft-view-mode"]) document.cookie = `${name}=; path=/; max-age=0`;
});

describe("useEscapeTogglesView", () => {
  it("steps Simple → Board → List → Simple", () => {
    setBoardMode("regular");
    const onFlip = vi.fn();
    renderHook(() => useEscapeTogglesView(bare, { onFlip }));
    press();
    expect([boardMode(), viewMode()]).toEqual(["advanced", "board"]);
    expect(onFlip).toHaveBeenLastCalledWith("board");
    press();
    expect([boardMode(), viewMode()]).toEqual(["advanced", "list"]);
    expect(onFlip).toHaveBeenLastCalledWith("list");
    press();
    expect(boardMode()).toBe("regular");
    expect(onFlip).toHaveBeenLastCalledWith("simple");
  });

  it("does nothing while something else is open", () => {
    const onFlip = vi.fn();
    renderHook(() => useEscapeTogglesView({ ...bare, browser: true }, { onFlip }));
    press();
    expect(onFlip).not.toHaveBeenCalled();
    expect(currentStop()).toBe("board");
  });

  it("steps under a pinned rail drawer, which Escape never closes", () => {
    localStorage.setItem("weft.libraryPinned", "1");
    renderHook(() => useEscapeTogglesView({ ...bare, drawer: true }));
    press();
    expect(currentStop()).toBe("list");
    localStorage.clear();
  });

  it("waits for an unpinned drawer to close first", () => {
    renderHook(() => useEscapeTogglesView({ ...bare, drawer: true }));
    press();
    expect(currentStop()).toBe("board");
  });

  it("leaves the view alone when Escape is typed in a field", () => {
    const onFlip = vi.fn();
    renderHook(() => useEscapeTogglesView(bare, { onFlip }));
    press(document.body.appendChild(document.createElement("input")));
    expect(onFlip).not.toHaveBeenCalled();
    expect(currentStop()).toBe("board");
  });

  it("stands down under an open dialog or menu", () => {
    const close = vi.fn();
    renderHook(() => {
      useEscapeTogglesView(bare);
      useEscape(true, close);
    });
    press();
    expect(close).toHaveBeenCalled();
    expect(currentStop()).toBe("board");
  });

  it("puts the hint away instead of stepping on while it is up, then steps once it's gone", () => {
    setViewMode("list");
    const onDismiss = vi.fn();
    const { rerender } = renderHook(({ up }: { up: boolean }) => useEscapeTogglesView(bare, { hintUp: up, onDismiss }), {
      initialProps: { up: true },
    });
    press();
    expect(onDismiss).toHaveBeenCalled();
    expect(currentStop()).toBe("list");
    rerender({ up: false });
    press();
    expect(currentStop()).toBe("simple");
  });
});

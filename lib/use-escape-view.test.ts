// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscape } from "./use-escape";
import { useEscapeTogglesView, type BoardLayers } from "./use-escape-view";

const bare: BoardLayers = { thread: false, newThread: false, browser: false, drawer: false };

function press(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useEscapeTogglesView", () => {
  it("flips board to list and list to board", () => {
    const choose = vi.fn();
    const { rerender } = renderHook(({ mode }) => useEscapeTogglesView(bare, mode, choose), {
      initialProps: { mode: "board" as "board" | "list" },
    });
    press();
    expect(choose).toHaveBeenLastCalledWith("list");
    rerender({ mode: "list" });
    press();
    expect(choose).toHaveBeenLastCalledWith("board");
  });

  it("does nothing while something else is open", () => {
    const choose = vi.fn();
    renderHook(() => useEscapeTogglesView({ ...bare, browser: true }, "board", choose));
    press();
    expect(choose).not.toHaveBeenCalled();
  });

  it("flips under a pinned rail drawer, which Escape never closes", () => {
    const choose = vi.fn();
    localStorage.setItem("weft.libraryPinned", "1");
    renderHook(() => useEscapeTogglesView({ ...bare, drawer: true }, "board", choose));
    press();
    expect(choose).toHaveBeenCalledWith("list");
    localStorage.clear();
  });

  it("waits for an unpinned drawer to close first", () => {
    const choose = vi.fn();
    renderHook(() => useEscapeTogglesView({ ...bare, drawer: true }, "board", choose));
    press();
    expect(choose).not.toHaveBeenCalled();
  });

  it("leaves the view alone when Escape is typed in a field", () => {
    const choose = vi.fn();
    renderHook(() => useEscapeTogglesView(bare, "board", choose));
    const input = document.body.appendChild(document.createElement("input"));
    press(input);
    expect(choose).not.toHaveBeenCalled();
  });

  it("stands down under an open dialog or menu", () => {
    const choose = vi.fn();
    const close = vi.fn();
    renderHook(() => {
      useEscapeTogglesView(bare, "board", choose);
      useEscape(true, close);
    });
    press();
    expect(close).toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
  });
});

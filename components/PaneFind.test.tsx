// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuAction } from "@/lib/client";
import { PaneFindField, usePaneFind } from "./PaneFind";

let menu: (action: MenuAction, payload?: string) => void;
let found: (result: { active: number; matches: number }) => void;
const browser = { find: vi.fn(), stopFind: vi.fn(), onFound: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  browser.onFound.mockImplementation((fn: typeof found) => {
    found = fn;
    return () => {};
  });
  window.weft = {
    browser,
    onMenu: (fn: typeof menu) => {
      menu = fn;
      return () => {};
    },
  } as never;
});
afterEach(() => {
  cleanup();
  delete window.weft;
});

function Pane({ url = "https://a.b" }: { url?: string }) {
  const find = usePaneFind({ url, tab: 1 });
  return find.open ? <PaneFindField find={find} /> : <p>address</p>;
}

describe("PaneFind", () => {
  it("opens only for a ⌘F the page had, and searches as you type", () => {
    render(<Pane />);
    act(() => menu("find"));
    expect(screen.getByText("address")).toBeTruthy();
    act(() => menu("find", "pane"));
    const input = screen.getByRole("textbox");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "cat" } });
    expect(browser.find).toHaveBeenLastCalledWith("cat");
    expect(screen.getByText("…")).toBeTruthy();
    act(() => found({ active: 2, matches: 5 }));
    expect(screen.getByText("2 of 5")).toBeTruthy();
    act(() => found({ active: 0, matches: 0 }));
    expect(screen.getByText("0 of 0")).toBeTruthy();
  });

  it("steps by Enter and by ⌘G, while open, from the field or the page", () => {
    render(<Pane />);
    act(() => menu("find-next", "pane"));
    expect(browser.find).not.toHaveBeenCalled();
    act(() => menu("find", "pane"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "cat" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(browser.find).toHaveBeenLastCalledWith("cat", { forward: false, next: true });
    act(() => menu("find-next", "pane"));
    expect(browser.find).toHaveBeenLastCalledWith("cat", { forward: true, next: true });
    act(() => menu("find-previous"));
    expect(browser.find).toHaveBeenLastCalledWith("cat", { forward: false, next: true });
  });

  it("searches again on a new page, and stops when the query empties", () => {
    const { rerender } = render(<Pane />);
    act(() => menu("find", "pane"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "cat" } });
    browser.find.mockClear();
    rerender(<Pane url="https://c.d" />);
    expect(browser.find).toHaveBeenCalledWith("cat");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(browser.stopFind).toHaveBeenCalledWith(false);
  });

  it("closes on Esc, handing the keyboard back to the page", () => {
    render(<Pane />);
    act(() => menu("find", "pane"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(browser.stopFind).toHaveBeenCalledWith(true);
    expect(screen.getByText("address")).toBeTruthy();
  });

  it("takes ⌘F again while its own field has the focus", () => {
    render(<Pane />);
    act(() => menu("find", "pane"));
    act(() => menu("find"));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("leaves no highlights behind when the pane goes", () => {
    const { unmount } = render(<Pane />);
    act(() => menu("find", "pane"));
    browser.stopFind.mockClear();
    unmount();
    expect(browser.stopFind).toHaveBeenCalledWith(false);
  });
});

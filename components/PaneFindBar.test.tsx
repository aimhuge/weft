// @vitest-environment jsdom
// The browser pane's find bar: typing searches the page, Enter / ⇧Enter / ⌘G step, Escape and ✕ close,
// and the count comes back from the shell. window.weft.browser is a stub that records the calls.
import "./test-utils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PaneFindBar from "./PaneFindBar";

type Found = { active: number; matches: number };
let sendFound: (found: Found) => void = () => {};
const browser = { find: vi.fn(), stopFind: vi.fn(), onFound: vi.fn((cb: (f: Found) => void) => ((sendFound = cb), () => {})) };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { weft: { browser } });
});

function setup(url = "https://a.co", focus = 1) {
  const onClose = vi.fn();
  const view = render(<PaneFindBar url={url} focus={focus} onClose={onClose} />);
  const field = screen.getByLabelText("Find in page");
  return { onClose, field, rerender: (u: string, f = focus) => view.rerender(<PaneFindBar url={u} focus={f} onClose={onClose} />) };
}

describe("PaneFindBar", () => {
  it("opens focused and searches as you type", () => {
    const { field } = setup();
    expect(field).toHaveFocus();
    expect(browser.find).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "hooks" } });
    expect(browser.find).toHaveBeenLastCalledWith("hooks");
  });

  it("shows the shell's count, and No matches", () => {
    const { field } = setup();
    fireEvent.change(field, { target: { value: "hooks" } });
    act(() => sendFound({ active: 2, matches: 7 }));
    expect(screen.getByText("2/7")).toBeInTheDocument();
    act(() => sendFound({ active: 0, matches: 0 }));
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByLabelText("Next match")).toBeDisabled();
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("steps through matches with Enter, ⇧Enter, ⌘G and the arrows", () => {
    const { field } = setup();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(browser.find).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "hooks" } });
    act(() => sendFound({ active: 1, matches: 3 }));
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "g", metaKey: true });
    fireEvent.keyDown(field, { key: "G", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(field, { key: "g" });
    fireEvent.click(screen.getByLabelText("Previous match"));
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(browser.find.mock.calls.slice(1)).toEqual([
      ["hooks", { forward: true, next: true }],
      ["hooks", { forward: false, next: true }],
      ["hooks", { forward: true, next: true }],
      ["hooks", { forward: false, next: true }],
      ["hooks", { forward: false, next: true }],
      ["hooks", { forward: true, next: true }],
    ]);
  });

  it("closes on Escape, ahead of the board's own Escape", () => {
    const { field, onClose } = setup();
    const board = vi.fn();
    window.addEventListener("keydown", board);
    fireEvent.keyDown(field, { key: "Escape" });
    window.removeEventListener("keydown", board);
    expect(browser.stopFind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(board).not.toHaveBeenCalled();
  });

  it("keeps ⌘F in the field instead of the board's card filter", () => {
    const { field } = setup();
    const board = vi.fn();
    window.addEventListener("keydown", board);
    fireEvent.keyDown(field, { key: "f", metaKey: true });
    window.removeEventListener("keydown", board);
    expect(board).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
  });

  it("closes on ✕", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByLabelText("Close find"));
    expect(browser.stopFind).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("searches a new page again, and takes the focus back on another ⌘F", () => {
    const { field, rerender } = setup();
    rerender("https://b.co");
    expect(browser.find).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "hooks" } });
    act(() => sendFound({ active: 1, matches: 3 }));
    rerender("https://c.co");
    expect(browser.find).toHaveBeenLastCalledWith("hooks");
    field.blur();
    rerender("https://c.co", 2);
    expect(field).toHaveFocus();
  });

  it("does nothing outside the desktop app", () => {
    Object.assign(window, { weft: undefined });
    const { field } = setup();
    fireEvent.change(field, { target: { value: "x" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(browser.find).not.toHaveBeenCalled();
  });
});

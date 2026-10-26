// @vitest-environment jsdom
// The list view's keyboard and drag: start typing to search titles, Space then B or R for a quick add, j and k left
// to the board, and Backlog rows dragged into order.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import { makeCard } from "./test-utils";
import { listProps, rows } from "./board-list.harness";

vi.mock("@/lib/client", () => ({ api: { create: vi.fn(), settings: vi.fn() } }));
vi.mock("@/lib/use-crons", () => ({ useCrons: () => ({ crons: [], update: vi.fn(), run: vi.fn() }) }));

import BoardList, { type BoardListProps } from "./BoardList";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function setup(over: Partial<BoardListProps> = {}) {
  return { view: render(<BoardList {...listProps(over)} />) };
}

describe("BoardList keys and drag", () => {
  it("starts a title search when you just start typing", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([["review", [makeCard({ id: "a", title: "Fix the sheet" }), makeCard({ id: "b", title: "Ship themes" })]]]),
    });
    fireEvent.keyDown(document.body, { key: "f" });
    const box = view.getByPlaceholderText("Type to filter titles…");
    expect(box).toHaveValue("f");
    expect(box).toHaveFocus();
    expect(rows(view.container)).toEqual(["Fix the sheet"]);
  });

  it("leaves letters alone while you type in a field or with a modifier, and keeps j and k", () => {
    const { view } = setup();
    const add = view.getByLabelText("Start a thread");
    fireEvent.keyDown(add, { key: "f" });
    fireEvent.keyDown(document.body, { key: "f", metaKey: true });
    fireEvent.keyDown(document.body, { key: "j" });
    expect(view.queryByPlaceholderText("Type to filter titles…")).toBeNull();
  });

  it("goes to the Backlog's quick add on Space then B, unfolding it", () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["backlog", [makeCard({ id: "b1", title: "Later" })]]]) });
    expect(view.queryByLabelText("New Backlog card title")).toBeNull();
    fireEvent.keyDown(document.body, { key: " " });
    expect(view.getByRole("status")).toHaveTextContent("Backlog");
    fireEvent.keyDown(document.body, { key: "b" });
    expect(view.getByLabelText("New Backlog card title")).toHaveFocus();
    expect(view.queryByRole("status")).toBeNull();
  });

  it("goes to Running's quick add on Space then R, and lets any other key through", () => {
    const { view } = setup();
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(view.getByLabelText("Start a thread")).toHaveFocus();
    fireEvent.keyDown(document.body, { key: " " });
    const passed = fireEvent.keyDown(document.body, { key: "n" });
    expect(passed).toBe(true);
    expect(view.queryByPlaceholderText("Type to filter titles…")).toBeNull();
  });

  it("drags a Backlog row onto another, but not while the sheet is sorted", () => {
    const onReorder = vi.fn();
    const backlog = [makeCard({ id: "b1", title: "First" }), makeCard({ id: "b2", title: "Second" })];
    const { view } = setup({ onReorder, byColumn: new Map<Column, Card[]>([["backlog", backlog]]) });
    fireEvent.click(view.getByRole("button", { name: /^Backlog/ }));
    const [first, second] = [...view.container.querySelectorAll("[draggable=true]")];
    const data = { effectAllowed: "", setData: vi.fn() };
    fireEvent.dragStart(second as Element, { dataTransfer: data });
    expect(second).toHaveClass("sheet-dragging");
    // jsdom's drag events carry no pointer position, so the drop reads as the lower half: below the row.
    fireEvent.dragOver(first as Element);
    expect(first).toHaveClass("sheet-drop-after");
    fireEvent.drop(first as Element);
    expect(onReorder).toHaveBeenCalledWith("b2", "b1", false);
    fireEvent.dragStart(first as Element, { dataTransfer: data });
    fireEvent.dragOver(second as Element);
    expect(second).toHaveClass("sheet-drop-after");
    fireEvent.dragEnd(first as Element);
    expect(second).not.toHaveClass("sheet-drop-after");
    fireEvent.click(view.getByTitle(/Sort by age/));
    expect(view.container.querySelectorAll("[draggable=true]")).toHaveLength(0);
  });
});

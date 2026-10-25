// @vitest-environment jsdom
// The list view: every card the board shows on one sheet, one row each, in the board's column
// order. CardRow is stubbed, so this pins what the list itself decides — the order and the rows.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import { makeCard } from "./test-utils";

const seen: { card: Card; column: Column }[] = [];
vi.mock("./CardRow", () => ({
  default: (p: { card: Card; column: Column }) => <div data-card-id={p.card.id}>{p.card.title}</div>,
}));

import BoardList, { type BoardListProps } from "./BoardList";

afterEach(() => {
  cleanup();
  seen.length = 0;
});

function setup(over: Partial<BoardListProps> = {}) {
  const props: BoardListProps = {
    byColumn: new Map<Column, Card[]>([
      ["running", [makeCard({ id: "r1", title: "Running one" })]],
      ["done", [makeCard({ id: "d1", title: "Done one" })]],
    ]),
    renderRow: (card, column) => {
      seen.push({ card, column });
      return <div data-card-id={card.id}>{card.title}</div>;
    },
    onNew: vi.fn(),
    ...over,
  };
  const view = render(<BoardList {...props} />);
  return { props, view };
}

describe("BoardList", () => {
  it("draws every card the board shows, in column order", () => {
    setup();
    expect(seen.map((r) => [r.card.id, r.column])).toEqual([
      ["r1", "running"],
      ["d1", "done"],
    ]);
  });

  it("says so when there are no cards", () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>() });
    expect(view.getByText("No cards yet.")).toBeInTheDocument();
  });

  it("heads each column, so the eye knows which group it is in", () => {
    const { view } = setup();
    expect(view.getByText("Running")).toBeInTheDocument();
    expect(view.getByText("Done")).toBeInTheDocument();
  });

  it("leaves out a column with no cards", () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["running", [makeCard({ id: "r1" })]]]) });
    expect(view.getByText("Running")).toBeInTheDocument();
    expect(view.queryByText("Review")).toBeNull();
  });

  it("opens New thread on a double-click in empty space", () => {
    const { props, view } = setup();
    // The sheet itself is empty space: no card, button or control under the pointer.
    fireEvent.doubleClick(view.container.querySelector("main")!);
    expect(props.onNew).toHaveBeenCalled();
  });

  it("opens New thread on a double-click in the empty state", () => {
    const { props, view } = setup({ byColumn: new Map<Column, Card[]>() });
    fireEvent.doubleClick(view.getByText("No cards yet."));
    expect(props.onNew).toHaveBeenCalled();
  });

  it("leaves a double-click on a row alone", () => {
    const { props, view } = setup();
    fireEvent.doubleClick(view.getByText("Running one"));
    expect(props.onNew).not.toHaveBeenCalled();
  });
});

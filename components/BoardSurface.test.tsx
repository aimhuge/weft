// @vitest-environment jsdom
// The board's middle: the columns or the list of every card, whichever the user picked. Both are
// stubbed, so this pins the switch itself.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import { makeCard } from "./test-utils";

vi.mock("./BoardColumns", () => ({
  default: () => <section data-board="columns">columns</section>,
}));
vi.mock("./BoardList", () => ({
  default: () => <section data-board="list">list</section>,
}));

import BoardSurface, { type BoardSurfaceProps } from "./BoardSurface";

afterEach(cleanup);

function setup(mode: "board" | "list") {
  const props: BoardSurfaceProps = {
    mode,
    columns: [{ id: "running", label: "Running" }],
    byColumn: new Map<Column, Card[]>([["running", [makeCard()]]]),
    allCards: [],
    expanded: [],
    onExpand: vi.fn(),
    renderCard: () => null,
    renderRow: () => null,
    loaded: true,
    filtering: false,
    laneState: "hidden",
    drag: { over: null, setOver: vi.fn(), onDrop: vi.fn(), onReorder: vi.fn() },
    onColumnMenu: vi.fn(),
    archive: { count: 0, shown: false, onToggleShown: vi.fn(), done: [], tip: "", cards: vi.fn(), restore: vi.fn() },
    review: { onReviewAll: vi.fn(async () => {}), filter: { errors: false, restart: false }, toggleFilter: vi.fn() },
    onNew: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
  };
  return { props, view: render(<BoardSurface {...props} />) };
}

describe("BoardSurface", () => {
  it("draws the columns in board mode", () => {
    const { view } = setup("board");
    expect(view.container.querySelector('[data-board="columns"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-board="list"]')).toBeNull();
  });

  it("draws the list in list mode", () => {
    const { view } = setup("list");
    expect(view.container.querySelector('[data-board="list"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-board="columns"]')).toBeNull();
  });
});

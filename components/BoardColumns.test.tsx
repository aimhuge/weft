// @vitest-environment jsdom
// Which column gets which extras: BoardColumn is stubbed to record its props, so this pins the
// per-column wiring Board.tsx used to do inline (Backlog's reorder and sprints, Review's Resume all,
// Review all and filter chips, Running and Needs you's Switch all, Show more, double-click to add).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";

const seen = new Map<string, Record<string, unknown>>();
vi.mock("./BoardColumn", () => ({
  COLUMN_LIMIT: 2,
  default: (props: Record<string, unknown> & { column: { id: string } }) => {
    seen.set(props.column.id, props);
    return <section data-column={props.column.id}><button>inside</button></section>;
  },
}));

import BoardColumns, { type BoardColumnsProps } from "./BoardColumns";
import { setBacklogFolded } from "@/lib/board-prefs";

afterEach(() => {
  cleanup();
  seen.clear();
  document.cookie = "weft-backlog-folded=; path=/; max-age=0";
});

const card = (id: string, column: Column, over: Partial<Card> = {}): Card =>
  ({ id, title: id, column, backend: "claude", permissionMode: "default", cwd: "/r", createdAt: 0, updatedAt: 0, ...over }) as Card;

const COLS: BoardColumnsProps["columns"] = [
  { id: "backlog", label: "Backlog" },
  { id: "running", label: "Running" },
  { id: "needs_you", label: "Needs you" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

function setup(over: Partial<BoardColumnsProps> = {}) {
  const backlog = [card("b1", "backlog"), card("b2", "backlog", { archived: true }), card("b3", "backlog")];
  const done = [card("d1", "done")];
  const props: BoardColumnsProps = {
    columns: COLS,
    byColumn: new Map<Column, Card[]>([["backlog", backlog], ["needs_you", [card("n1", "needs_you")]], ["review", [card("r1", "review")]], ["done", done]]),
    allCards: [...backlog, ...done],
    expanded: [],
    onExpand: vi.fn(),
    renderCard: () => null,
    loaded: true,
    filtering: false,
    laneState: "hidden",
    drag: { over: "review", onOver: vi.fn(), onLeave: vi.fn(), onDrop: vi.fn(), onReorder: vi.fn() },
    onColumnMenu: vi.fn(),
    archive: { count: 3, shown: false, onToggleShown: vi.fn(), done, tip: "Archive all 1", cards: vi.fn(), restore: vi.fn() },
    review: { resumeAll: { count: 1, run: vi.fn() }, onReviewAll: vi.fn(async () => {}), filter: { errors: false, restart: false }, toggleFilter: vi.fn() },
    onNew: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    ...over,
  };
  render(<BoardColumns {...props} />);
  return props;
}

const col = (id: Column) => seen.get(id) ?? {};
// Calls the handler BoardColumns gave column `id` as prop `name`.
const call = (id: Column, name: string, ...args: unknown[]) => (col(id)[name] as (...a: unknown[]) => unknown)(...args);

describe("BoardColumns' folded Backlog", () => {
  it("folds from Backlog's header to a strip with its count, which opens it again", () => {
    setup();
    act(() => (col("backlog").backlog as { onFold: () => void }).onFold());
    expect(document.querySelector("[data-folded]")?.textContent).toContain("Backlog3");
    seen.clear();
    fireEvent.click(screen.getByRole("button", { name: "Open Backlog" }));
    expect(seen.has("backlog")).toBe(true);
    expect(document.querySelector("[data-folded]")).toBeNull();
  });

  it("still takes a dropped card, and hides the count until the board loads", () => {
    setBacklogFolded(true);
    const p = setup({ loaded: false });
    expect(seen.has("backlog")).toBe(false);
    const strip = document.querySelector("[data-folded]") as HTMLElement;
    expect(strip.textContent).toBe("Backlog");
    fireEvent.dragOver(strip);
    expect(p.drag.onOver).toHaveBeenCalledWith("backlog");
    fireEvent.dragLeave(strip);
    expect(p.drag.onLeave).toHaveBeenCalledWith("backlog");
    fireEvent.drop(strip);
    expect(p.drag.onDrop).toHaveBeenCalledWith("backlog", expect.anything());
  });
});

describe("BoardColumns", () => {
  it("renders one column per visible column, capped at COLUMN_LIMIT unless expanded", () => {
    setup({ expanded: ["done"] });
    expect([...seen.keys()]).toEqual(["backlog", "running", "needs_you", "review", "done"]);
    expect(col("backlog").shown).toHaveLength(2);
    expect(col("backlog").count).toBe(3);
    expect(col("running").count).toBe(0);
    expect(col("done").shown).toHaveLength(1);
  });

  it("gives only Backlog its reorder and sprints, built from its unarchived cards", () => {
    const p = setup();
    expect(col("backlog").onReorder).toBe(p.drag.onReorder);
    expect(col("review").onReorder).toBeUndefined();
    const lane = col("backlog").backlog as { cards: Card[]; allCards: Card[]; onArchiveAll: () => void; onRestore: unknown };
    expect(lane.cards.map((c) => c.id)).toEqual(["b1", "b3"]);
    expect(lane.allCards).toBe(p.allCards);
    expect(lane.onRestore).toBe(p.archive.restore);
    lane.onArchiveAll();
    expect(vi.mocked(p.archive.cards).mock.calls[0]?.[0].map((c) => c.id)).toEqual(["b1", "b3"]);
    expect(col("done").backlog).toBeUndefined();
  });

  it("gives only Review Resume all, Review all and its filter chips", () => {
    const p = setup();
    expect(col("review").resumeAll).toBe(p.review.resumeAll);
    expect(col("review").onReviewAll).toBe(p.review.onReviewAll);
    expect(col("review").reviewFilter).toMatchObject({ on: p.review.filter, toggle: p.review.toggleFilter });
    expect(col("review").reviewFilter).toHaveProperty("counts");
    for (const id of ["backlog", "running", "needs_you", "done"] as Column[]) {
      expect(col(id).resumeAll).toBeUndefined();
      expect(col(id).onReviewAll).toBeUndefined();
      expect(col(id).reviewFilter).toBeUndefined();
    }
  });

  it("offers Switch all on Running and Needs you only while a limit is hit", () => {
    setup();
    expect(col("running").onSwitchAll).toBeUndefined();
    cleanup();
    seen.clear();
    const onSwitchAll = vi.fn();
    setup({ onSwitchAll });
    expect(col("backlog").onSwitchAll).toBeUndefined();
    call("needs_you", "onSwitchAll");
    call("running", "onSwitchAll");
    expect(onSwitchAll.mock.calls).toEqual([["needs_you"], ["running"]]);
  });

  it("flags Needs you only when it has cards, and drag-over on the hovered column", () => {
    setup();
    expect(col("needs_you").needsYou).toBe(true);
    expect(col("review").needsYou).toBe(false);
    expect(col("review").dragOver).toBe(true);
    expect(col("done").dragOver).toBe(false);
  });

  it("passes each column's id to its handlers", () => {
    const p = setup();
    const e = { preventDefault: vi.fn() };
    call("done", "onDragOver", e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(p.drag.onOver).toHaveBeenCalledWith("done");
    call("done", "onDragLeave");
    expect(p.drag.onLeave).toHaveBeenCalledWith("done");
    call("done", "onDrop", e);
    expect(p.drag.onDrop).toHaveBeenCalledWith("done", e);
    call("done", "onColumnContextMenu", e);
    expect(p.onColumnMenu).toHaveBeenCalledWith("done", e);
    call("running", "onShowMore");
    expect(p.onExpand).toHaveBeenCalledWith("running");
    call("done", "onArchiveAll");
    expect(p.archive.cards).toHaveBeenCalledWith(p.archive.done);
    expect(col("done").toArchive).toBe(1);
    expect(col("done").archivedCount).toBe(3);
    expect(col("done").onToggleArchived).toBe(p.archive.onToggleShown);
    call("backlog", "onAddBacklog");
    expect(p.onNew).toHaveBeenCalledTimes(1);
  });

  it("opens New thread on a double-click on empty board space, not on a control", () => {
    const p = setup();
    fireEvent.doubleClick(document.querySelector("button")!);
    expect(p.onNew).not.toHaveBeenCalled();
    fireEvent.doubleClick(document.querySelector("main")!);
    expect(p.onNew).toHaveBeenCalledTimes(1);
  });
});

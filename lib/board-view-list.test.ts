import { describe, expect, it } from "vitest";
import { groupByColumn, listGroups, listRows, type BoardView } from "./board-view";
import type { Card, Column } from "./types";

const card = (over: Partial<Card>): Card =>
  ({ id: "c", title: "t", prompt: "p", cwd: "/", backend: "claude", permissionMode: "default", column: "running", createdAt: 1, updatedAt: 1, ...over });

const view: BoardView = { project: null, query: "", sort: "active", showArchived: false };

describe("listRows", () => {
  it("lists every card the board shows, in column order", () => {
    const groups = groupByColumn(
      [card({ id: "r", column: "running" }), card({ id: "d", column: "done" }), card({ id: "n", column: "needs_you" })],
      view,
      (cwd) => cwd,
    );
    expect(listRows(groups).map((row) => [row.card.id, row.column])).toEqual([
      ["r", "running"],
      ["n", "needs_you"],
      ["d", "done"],
    ]);
  });

  it("keeps each column's own order within the list", () => {
    const groups = groupByColumn(
      [card({ id: "old", column: "running", createdAt: 1 }), card({ id: "new", column: "running", createdAt: 9 })],
      { ...view, sort: "newest" },
      (cwd) => cwd,
    );
    expect(listRows(groups).map((row) => row.card.id)).toEqual(["new", "old"]);
  });

  it("names the column each row sits in", () => {
    const groups = groupByColumn([card({ id: "b", column: "backlog" })], view, (cwd) => cwd);
    const rows = listRows(groups);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.column).toBe("backlog");
    expect(rows[0]!.card.id).toBe("b");
  });

  it("draws a wrapping-up card under Done, like the board does", () => {
    const groups = groupByColumn([card({ id: "w", wrappingUp: true })], view, (cwd) => cwd);
    expect(listRows(groups).map((row) => row.column)).toEqual(["done"]);
  });

  it("is empty when the board shows no cards", () => {
    expect(listRows(new Map<Column, Card[]>())).toEqual([]);
  });
});

describe("listGroups", () => {
  it("groups the cards under their column's name, in column order", () => {
    const groups = groupByColumn(
      [card({ id: "r", column: "running" }), card({ id: "n", column: "needs_you" }), card({ id: "d", column: "done" })],
      view,
      (cwd) => cwd,
    );
    expect(listGroups(groups).map((g) => [g.label, g.cards.map((c) => c.id)])).toEqual([
      ["Running", ["r"]],
      ["Needs you", ["n"]],
      ["Done", ["d"]],
    ]);
  });

  it("leaves out a column with no cards", () => {
    const groups = groupByColumn([card({ id: "r", column: "running" })], view, (cwd) => cwd);
    expect(listGroups(groups).map((g) => g.column)).toEqual(["running"]);
  });

  it("is empty when the board shows no cards", () => {
    expect(listGroups(new Map<Column, Card[]>())).toEqual([]);
  });
});

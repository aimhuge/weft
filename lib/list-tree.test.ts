import { describe, expect, it } from "vitest";
import type { ListGroup } from "./board-view";
import { EMPTY_SHEET } from "./list-sheet";
import { agentsOf, bandsToDraw, LIST_ORDER, parentOf, sheetGroups } from "./list-tree";
import type { CardTask } from "./tasks";
import type { Card } from "./types";

const NOW = 1_800_000_000_000;
let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${seq}`,
    title: "Untitled",
    prompt: "do it",
    cwd: "/dev/weft",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
const task = (overrides: Partial<CardTask> = {}): CardTask => ({
  id: `t${seq}`,
  kind: "agent",
  description: "Explore",
  status: "running",
  startedAt: NOW,
  ...overrides,
});
const group = (column: ListGroup["column"], cards: Card[]): ListGroup => ({
  column,
  label: column,
  cards,
});
const rowIds = (rows: { kind: string; card?: Card }[]) =>
  rows.filter((r) => r.kind === "card").map((r) => r.card?.id);
const depths = (rows: { kind: string; depth: number }[]) => rows.map((r) => r.depth);

describe("parentOf", () => {
  it("folds a cron run under the card it came from", () => {
    expect(parentOf(card({ id: "run", cronOf: "c1" }))).toBe("c1");
  });

  it("falls back to the thread that started the card", () => {
    expect(parentOf(card({ parentId: "c2" }))).toBe("c2");
    expect(parentOf(card())).toBeUndefined();
  });

  it("ignores a cron that points at the card itself", () => {
    expect(parentOf(card({ id: "c9", cronOf: "c9" }))).toBeUndefined();
    expect(parentOf(card({ id: "c9", cronOf: "c9", parentId: "c3" }))).toBe("c3");
  });
});

describe("agentsOf", () => {
  it("keeps only the subagents, in the order the card lists them", () => {
    const c = card({ tasks: [task({ id: "a" }), task({ id: "b", kind: "shell" }), task({ id: "c" })] });
    expect(agentsOf(c).map((t) => t.id)).toEqual(["a", "c"]);
    expect(agentsOf(card())).toEqual([]);
  });
});

describe("sheetGroups", () => {
  it("lays the bands out in the order you act on them", () => {
    const a = card({ column: "done" });
    const b = card({ column: "backlog" });
    const c = card({ column: "needs_you" });
    const d = card({ column: "review" });
    const e = card({ column: "running" });
    const out = sheetGroups(
      [
        group("done", [a]),
        group("backlog", [b]),
        group("needs_you", [c]),
        group("review", [d]),
        group("running", [e]),
      ],
      { ...EMPTY_SHEET, collapsed: [] },
      new Set(),
      NOW,
    );
    expect(out.groups.map((g) => g.column)).toEqual(LIST_ORDER);
  });

  it("keeps a folded band's count but draws no rows", () => {
    const a = card({ column: "backlog" });
    const out = sheetGroups([group("backlog", [a])], { ...EMPTY_SHEET, collapsed: ["backlog"] }, new Set(), NOW);
    expect(out.groups).toHaveLength(1);
    expect(out.groups.at(0)?.rows).toEqual([]);
    expect(out.groups.at(0)?.collapsed).toBe(true);
    expect(out.groups.at(0)?.shown).toBe(1);
    expect(out.groups.at(0)?.total).toBe(1);
  });

  it("nests a child under the card that started it, and a cron run under its holder", () => {
    const parent = card({ column: "running" });
    const child = card({ column: "running", parentId: parent.id });
    const cron = card({ column: "running", cronOf: parent.id });
    const out = sheetGroups([group("running", [parent, child, cron])], { ...EMPTY_SHEET, collapsed: [] }, new Set([parent.id]), NOW);
    const rows = out.groups.at(0)?.rows ?? [];
    expect(rows.map((r) => r.kind)).toEqual(["card", "card", "card"]);
    expect(rowIds(rows)).toEqual([parent.id, child.id, cron.id]);
    expect(depths(rows)).toEqual([0, 1, 1]);
  });

  it("folds the children away when their parent is closed", () => {
    const parent = card({ column: "running" });
    const child = card({ column: "running", parentId: parent.id });
    const out = sheetGroups([group("running", [parent, child])], { ...EMPTY_SHEET, collapsed: [] }, new Set(), NOW);
    const rows = out.groups.at(0)?.rows ?? [];
    expect(rowIds(rows)).toEqual([parent.id]);
    expect(rows.at(0)).toMatchObject({ kind: "card", expanded: false });
  });

  it("shows an opened card's subagents, then the cards under it", () => {
    const parent = card({ column: "running", tasks: [task({ id: "ag1" }), task({ id: "sh1", kind: "shell" })] });
    const child = card({ column: "running", parentId: parent.id });
    const out = sheetGroups([group("running", [parent, child])], { ...EMPTY_SHEET, collapsed: [] }, new Set([parent.id]), NOW);
    const rows = out.groups.at(0)?.rows ?? [];
    expect(rows.map((r) => r.kind)).toEqual(["card", "agent", "card"]);
    const agentRow = rows.at(1);
    expect(agentRow?.kind).toBe("agent");
    expect(agentRow?.kind === "agent" ? agentRow.task.id : null).toBe("ag1");
    expect(agentRow?.kind === "agent" ? agentRow.depth : null).toBe(1);
    const childRow = rows.at(2);
    expect(childRow?.kind).toBe("card");
    expect(childRow?.kind === "card" ? childRow.depth : null).toBe(1);
  });

  it("counts the kids under a card and numbers the rows across the bands", () => {
    const parent = card({ column: "running", tasks: [task({ id: "ag1" })] });
    const child = card({ column: "running", parentId: parent.id });
    const other = card({ column: "done" });
    const out = sheetGroups([group("running", [parent, child]), group("done", [other])], { ...EMPTY_SHEET, collapsed: [] }, new Set([parent.id]), NOW);
    const parentRow = (out.groups.at(0)?.rows ?? []).at(0);
    expect(parentRow?.kind === "card" ? parentRow.kids : null).toBe(2);
    const numbers = out.groups.flatMap((g) =>
      g.rows.filter((r) => r.kind === "card").map((r) => r.number),
    );
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("keeps a parent whose child is the only one that matches", () => {
    const parent = card({ title: "Parent", column: "running" });
    const child = card({ title: "Needle", column: "running", parentId: parent.id });
    const out = sheetGroups(
      [group("running", [parent, child])],
      { ...EMPTY_SHEET, collapsed: [], query: "needle" },
      new Set([parent.id]),
      NOW,
    );
    expect(rowIds(out.groups.at(0)?.rows ?? [])).toEqual([parent.id, child.id]);
  });

  it("keeps both cards of a parent→child loop at the top level", () => {
    const a = card({ column: "running" });
    const b = card({ column: "running", parentId: a.id });
    a.parentId = b.id;
    const out = sheetGroups([group("running", [a, b])], { ...EMPTY_SHEET, collapsed: [] }, new Set(), NOW);
    expect(rowIds(out.groups.at(0)?.rows ?? [])).toEqual([a.id, b.id]);
    expect(depths(out.groups.at(0)?.rows ?? [])).toEqual([0, 0]);
  });

  it("shows a card that waits on you in Needs you and under its parent", () => {
    const parent = card({ column: "running" });
    const child = card({ column: "needs_you", parentId: parent.id });
    const out = sheetGroups(
      [group("running", [parent]), group("needs_you", [child])],
      { ...EMPTY_SHEET, collapsed: [] },
      new Set([parent.id]),
      NOW,
    );
    expect(out.groups.map((g) => g.column)).toEqual(["needs_you", "running"]);
    expect(rowIds(out.groups.at(0)?.rows ?? [])).toEqual([child.id]);
    expect(rowIds(out.groups.at(1)?.rows ?? [])).toEqual([parent.id, child.id]);
  });

  it("shows a child on its own when its tree's top card sits in a folded band", () => {
    const parent = card({ column: "backlog" });
    const child = card({ column: "running", parentId: parent.id });
    const out = sheetGroups(
      [group("backlog", [parent]), group("running", [child])],
      { ...EMPTY_SHEET, collapsed: ["backlog"] },
      new Set(),
      NOW,
    );
    const running = out.groups.find((g) => g.column === "running");
    expect(rowIds(running?.rows ?? [])).toEqual([child.id]);
    const backlog = out.groups.find((g) => g.column === "backlog");
    expect(backlog?.rows).toEqual([]);
  });

  it("leaves a child at the top level when its parent isn't on the sheet", () => {
    const child = card({ column: "running", parentId: "missing" });
    const out = sheetGroups([group("running", [child])], { ...EMPTY_SHEET, collapsed: [] }, new Set(), NOW);
    expect(rowIds(out.groups.at(0)?.rows ?? [])).toEqual([child.id]);
    const row = (out.groups.at(0)?.rows ?? []).at(0);
    expect(row?.kind === "card" ? row.depth : null).toBe(0);
  });

  it("drops a band with nothing that matches, and counts shown of total", () => {
    const a = card({ title: "keep", column: "running" });
    const b = card({ title: "drop", column: "review" });
    const out = sheetGroups(
      [group("running", [a]), group("review", [b])],
      { ...EMPTY_SHEET, collapsed: [], query: "keep" },
      new Set(),
      NOW,
    );
    expect(out.groups.map((g) => g.column)).toEqual(["running"]);
    expect(out.shown).toBe(1);
    expect(out.total).toBe(2);
  });

  it("skips a band the board doesn't have", () => {
    const out = sheetGroups([group("running", [card({ column: "running" })])], { ...EMPTY_SHEET, collapsed: [] }, new Set(), NOW);
    expect(out.groups.map((g) => g.column)).toEqual(["running"]);
    expect(out.shown).toBe(1);
    expect(out.total).toBe(1);
  });

  it("sorts the rows and hides a card a filter drops", () => {
    const a = card({ title: "b", column: "running" });
    const b = card({ title: "a", column: "running" });
    const c = card({ title: "c", column: "running" });
    const out = sheetGroups(
      [group("running", [a, b, c])],
      { sort: { key: "title", dir: "asc" }, hidden: {}, query: "", collapsed: [] },
      new Set(),
      NOW,
    );
    expect(rowIds(out.groups.at(0)?.rows ?? [])).toEqual([b.id, a.id, c.id]);
  });
});

describe("bandsToDraw", () => {
  it("keeps the bands with cards and adds an empty Backlog and Running to type into", () => {
    const review = { column: "review" as const, label: "Review", rows: [], shown: 1, total: 1, collapsed: false };
    const out = bandsToDraw([review], ["backlog"]);
    expect(out.map((g) => [g.column, g.collapsed, g.total])).toEqual([
      ["backlog", true, 0],
      ["running", false, 0],
      ["review", false, 1],
    ]);
  });
});

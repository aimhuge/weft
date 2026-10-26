import { describe, expect, it } from "vitest";
import {
  BLANK,
  cellValues,
  CRON_TAG,
  EMPTY_SHEET,
  filterCount,
  flipSort,
  keepOnly,
  nextSort,
  NUMERIC,
  parseSheetState,
  rowMatches,
  rowStatus,
  sortRows,
  toggleCollapsed,
  toggleHidden,
  valueCounts,
} from "./list-sheet";
import type { Card, PendingPermission } from "./types";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
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
const pending = (p: Partial<PendingPermission>) => p as PendingPermission;
const ids = (cards: Card[]) => cards.map((c) => c.id);

describe("rowStatus", () => {
  it("names an error, a wait, a question, a permission, a running turn and a card that needs you", () => {
    expect(rowStatus(card({ error: "boom" }))).toMatchObject({ word: "Error", tip: "boom" });
    expect(rowStatus(card({ pending: pending({ waiting: true }) }))?.word).toBe("Waiting");
    expect(rowStatus(card({ pending: pending({ questions: [], title: "Pick" }) }))).toMatchObject({ word: "Question", tip: "Pick" });
    expect(rowStatus(card({ pending: pending({ title: "Bash" }) }))).toMatchObject({ word: "Permission", tip: "Bash" });
    expect(rowStatus(card({ column: "running" }))).toMatchObject({ word: "Running", spinner: true });
    expect(rowStatus(card({ column: "needs_you", lastLine: "ok?" }))).toMatchObject({ word: "Needs you", tip: "ok?" });
    expect(rowStatus(card())).toBeNull();
  });
});

describe("cellValues", () => {
  it("reads each column, with blanks named", () => {
    const c = card({ title: "T", stage: "First shot", tags: ["bug", "ui"], cwd: "/a/b/proj", updatedAt: NOW - 2 * HOUR });
    expect(cellValues(c, "title", NOW)).toEqual(["T"]);
    expect(cellValues(c, "status", NOW)).toEqual([BLANK]);
    expect(cellValues(c, "stage", NOW)).toEqual(["First shot"]);
    expect(cellValues(c, "tags", NOW)).toEqual(["bug", "ui"]);
    expect(cellValues(c, "folder", NOW)).toEqual(["proj"]);
    expect(cellValues(c, "age", NOW)).toEqual(["Today"]);
    const bare = card({ role: "copilot", lastActivity: NOW - 30 * 86_400_000 });
    expect(cellValues(bare, "stage", NOW)).toEqual([BLANK]);
    expect(cellValues(bare, "tags", NOW)).toEqual([BLANK]);
    expect(cellValues(bare, "folder", NOW)).toEqual(["whole board"]);
    expect(cellValues(bare, "age", NOW)).toEqual(["Older"]);
    expect(cellValues(card({ updatedAt: NOW + 5 }), "age", NOW)).toEqual(["Last hour"]);
  });

  it("adds ⏰ cron after the tags of a cron's run", () => {
    expect(cellValues(card({ cronId: "cron1", tags: ["bug", "ui"] }), "tags", NOW)).toEqual(["bug", "ui", CRON_TAG]);
    // A cron run with no tags of its own has just the cron tag.
    expect(cellValues(card({ cronId: "cron1" }), "tags", NOW)).toEqual([CRON_TAG]);
  });
});

describe("sortRows", () => {
  it("leaves the order alone with no sort", () => {
    const cards = [card(), card()];
    expect(sortRows(cards, null, NOW)).toBe(cards);
  });

  it("sorts titles A→Z and Z→A, numbers naturally, ties in board order", () => {
    const a = card({ title: "item 10" });
    const b = card({ title: "Item 2" });
    const c = card({ title: "item 2" });
    expect(ids(sortRows([a, b, c], { key: "title", dir: "asc" }, NOW))).toEqual([b.id, c.id, a.id]);
    expect(ids(sortRows([a, b, c], { key: "title", dir: "desc" }, NOW))).toEqual([a.id, b.id, c.id]);
  });

  it("orders stages by the pipeline and statuses loudest first, blanks last both ways", () => {
    const plan = card({ stage: "Planning" });
    const done = card({ stage: "Done" });
    const odd = card({ stage: "Mystery" });
    const none = card();
    expect(ids(sortRows([none, done, odd, plan], { key: "stage", dir: "asc" }, NOW))).toEqual([plan.id, done.id, odd.id, none.id]);
    expect(ids(sortRows([none, done, odd, plan], { key: "stage", dir: "desc" }, NOW))).toEqual([odd.id, done.id, plan.id, none.id]);
    const err = card({ error: "x" });
    const run = card({ column: "running" });
    expect(ids(sortRows([none, run, err], { key: "status", dir: "asc" }, NOW))).toEqual([err.id, run.id, none.id]);
    expect(ids(sortRows([run, none], { key: "status", dir: "desc" }, NOW))).toEqual([run.id, none.id]);
  });

  it("sorts age by the real time, youngest first ascending", () => {
    const old = card({ updatedAt: NOW - 5 * HOUR });
    const young = card({ updatedAt: NOW - HOUR, lastActivity: NOW - 1000 });
    expect(ids(sortRows([old, young], { key: "age", dir: "asc" }, NOW))).toEqual([young.id, old.id]);
    expect(ids(sortRows([old, young], { key: "age", dir: "desc" }, NOW))).toEqual([old.id, young.id]);
  });

  it("sorts folders and tags A→Z", () => {
    const z = card({ cwd: "/zeta", tags: ["ui"] });
    const a = card({ cwd: "/alpha", tags: ["bug"] });
    expect(ids(sortRows([z, a], { key: "folder", dir: "asc" }, NOW))).toEqual([a.id, z.id]);
    expect(ids(sortRows([z, a], { key: "tags", dir: "asc" }, NOW))).toEqual([a.id, z.id]);
  });
});

describe("rowMatches", () => {
  const bug = card({ tags: ["bug"], stage: "Planning" });
  const both = card({ tags: ["bug", "ui"] });
  const bare = card();

  it("keeps everything with no filter", () => {
    expect(rowMatches(bug, {}, "", NOW)).toBe(true);
    expect(rowMatches(bug, { tags: [] }, "", NOW)).toBe(true);
  });

  it("hides a card only when every value it has is unticked, across every filtered column", () => {
    expect(rowMatches(bug, { tags: ["bug"] }, "", NOW)).toBe(false);
    expect(rowMatches(both, { tags: ["bug"] }, "", NOW)).toBe(true);
    expect(rowMatches(bare, { tags: ["bug"] }, "", NOW)).toBe(true);
    // A card with no tags at all has only the blank value, so unticking it hides the card.
    expect(rowMatches(bug, { tags: [BLANK] }, "", NOW)).toBe(true);
    expect(rowMatches(bare, { tags: [BLANK] }, "", NOW)).toBe(false);
    // Two unticked columns: the card has to be hidden in both to go.
    expect(rowMatches(bug, { tags: [BLANK], stage: ["Planning"] }, "", NOW)).toBe(false);
    expect(rowMatches(both, { tags: [BLANK], stage: ["Planning"] }, "", NOW)).toBe(true);
    expect(rowMatches(bare, { tags: [BLANK], stage: [BLANK] }, "", NOW)).toBe(false);
  });

  it("keeps a card whose title has every query word, and drops one that doesn't", () => {
    expect(rowMatches(card({ title: "Alpha beta" }), {}, "alpha", NOW)).toBe(true);
    expect(rowMatches(card({ title: "Alpha beta" }), {}, "alpha gamma", NOW)).toBe(false);
  });
});

describe("valueCounts", () => {
  it("counts each value once per card, in the column's order, blanks last", () => {
    const cards = [card({ stage: "Done" }), card(), card({ stage: "Planning" }), card({ stage: "Planning" })];
    expect(valueCounts(cards, "stage", NOW)).toEqual([
      { value: "Planning", count: 2 },
      { value: "Done", count: 1 },
      { value: BLANK, count: 1 },
    ]);
    expect(valueCounts([card({ tags: ["b", "a"] }), card({ tags: ["a"] }), card()], "tags", NOW)).toEqual([
      { value: "a", count: 2 },
      { value: "b", count: 1 },
      { value: BLANK, count: 1 },
    ]);
    expect(valueCounts([card(), card({ tags: ["x"] })], "tags", NOW).at(-1)?.value).toBe(BLANK);
    expect(valueCounts([card({ updatedAt: NOW - 30 * 86_400_000 }), card()], "age", NOW).map((v) => v.value)).toEqual(["Last hour", "Older"]);
  });
});

describe("nextSort, flipSort, toggleHidden, keepOnly, toggleCollapsed, filterCount", () => {
  it("cycles a header A→Z, Z→A, off, and starts a new column at A→Z", () => {
    expect(nextSort(null, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title")).toBeNull();
    expect(nextSort({ key: "title", dir: "desc" }, "age")).toEqual({ key: "age", dir: "asc" });
  });

  it("flips a number column between ascending and descending", () => {
    expect(flipSort(null, "age")).toEqual({ key: "age", dir: "asc" });
    expect(flipSort({ key: "age", dir: "asc" }, "age")).toEqual({ key: "age", dir: "desc" });
    expect(flipSort({ key: "age", dir: "desc" }, "age")).toEqual({ key: "age", dir: "asc" });
    expect(flipSort({ key: "title", dir: "asc" }, "age")).toEqual({ key: "age", dir: "asc" });
    expect(NUMERIC).toEqual(["age"]);
  });

  it("ticks and unticks a value", () => {
    const once = toggleHidden({}, "tags", "bug");
    expect(once).toEqual({ tags: ["bug"] });
    expect(toggleHidden(once, "tags", "bug")).toEqual({ tags: [] });
  });

  it("keeps only the ticked values and clears the column when none are kept", () => {
    expect(keepOnly({}, "tags", ["bug", "ui"], ["bug"])).toEqual({ tags: ["ui"] });
    expect(keepOnly({ stage: ["Planning"] }, "tags", ["bug"], [])).toEqual({ stage: ["Planning"], tags: [] });
  });

  it("folds and opens a band", () => {
    expect(toggleCollapsed([], "backlog")).toEqual(["backlog"]);
    expect(toggleCollapsed(["backlog"], "backlog")).toEqual([]);
  });

  it("counts the filtered columns and the title search", () => {
    expect(filterCount({ tags: ["bug"], stage: [], age: ["Older"] })).toBe(2);
    expect(filterCount({}, "")).toBe(0);
    expect(filterCount({}, "  ")).toBe(0);
    expect(filterCount({}, "bug")).toBe(1);
    expect(filterCount({ tags: ["bug"] }, "bug")).toBe(2);
  });
});

describe("parseSheetState", () => {
  it("reads a saved sheet and drops what it doesn't know", () => {
    expect(parseSheetState(null)).toBe(EMPTY_SHEET);
    expect(parseSheetState("{bad")).toBe(EMPTY_SHEET);
    expect(
      parseSheetState(
        JSON.stringify({ sort: { key: "age", dir: "desc" }, hidden: { tags: ["a", 3], nope: ["x"], stage: "x" }, query: "needle", collapsed: ["review", "nope"] }),
      ),
    ).toEqual({
      sort: { key: "age", dir: "desc" },
      hidden: { tags: ["a"] },
      query: "needle",
      collapsed: ["review"],
    });
    expect(parseSheetState(JSON.stringify({ sort: { key: "nope", dir: "asc" } }))).toEqual({
      sort: null,
      hidden: {},
      query: "",
      collapsed: ["backlog"],
    });
    expect(parseSheetState(JSON.stringify({ sort: { key: "age", dir: "up" } })).sort).toBeNull();
    expect(parseSheetState(JSON.stringify({ query: 42 })).query).toBe("");
    expect(parseSheetState(JSON.stringify({ collapsed: "review" })).collapsed).toEqual(["backlog"]);
    // The Crons band is a band like any other, so it survives a saved sheet.
    expect(parseSheetState(JSON.stringify({ collapsed: ["crons"] })).collapsed).toEqual(["crons"]);
    expect(EMPTY_SHEET).toEqual({ sort: null, hidden: {}, query: "", collapsed: ["backlog"] });
  });
});

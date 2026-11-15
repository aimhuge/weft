// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { foldedColumns } from "./board-prefs";
import { foldColumn, openedPiles, pileFolded, sidebarSections, threePileColumns } from "./three-piles";
import { COLUMNS, type Card, type Column } from "./types";

const clear = () => {
  document.cookie = "weft-simple-opened-columns=; path=/; max-age=0";
  document.cookie = "weft-folded-columns=; path=/; max-age=0";
};

afterEach(clear);

describe("threePileColumns", () => {
  it("orders Backlog, Needs you, Working, Ready, Done and renames only Running and Review", () => {
    expect(threePileColumns(COLUMNS)).toEqual([
      { id: "backlog", label: "Backlog" },
      { id: "needs_you", label: "Needs you" },
      { id: "running", label: "Working" },
      { id: "review", label: "Ready" },
      { id: "done", label: "Done" },
    ]);
  });

  it("keeps a hidden column hidden and leaves its input alone", () => {
    const shown = COLUMNS.filter((c) => c.id !== "backlog");
    expect(threePileColumns(shown).map((c) => c.id)).toEqual(["needs_you", "running", "review", "done"]);
    expect(shown[0]).toEqual({ id: "running", label: "Running" });
  });
});

describe("pileFolded and foldColumn", () => {
  it("follows the fold cookie with the piece off", () => {
    expect(pileFolded(false, "", "", "done")).toBe(false);
    expect(pileFolded(false, "done", "", "done")).toBe(true);
    foldColumn(false, "running", true);
    expect(foldedColumns()).toBe("running");
    foldColumn(false, "running", false);
    expect(foldedColumns()).toBe("");
  });

  it("folds Backlog and Done with the piece on until they're opened", () => {
    expect(pileFolded(true, "", "", "backlog")).toBe(true);
    expect(pileFolded(true, "", "", "done")).toBe(true);
    expect(pileFolded(true, "", "", "review")).toBe(false);
    expect(pileFolded(true, "review", "", "review")).toBe(true);
    expect(pileFolded(true, "", "done", "done")).toBe(false);
  });

  it("remembers an opened strip in its own cookie and tells the board", () => {
    const changed = vi.fn();
    window.addEventListener("weft-board-prefs", changed);
    expect(openedPiles()).toBe("");
    foldColumn(true, "done", false);
    foldColumn(true, "backlog", false);
    expect(openedPiles()).toBe("done,backlog");
    expect(foldedColumns()).toBe("");
    foldColumn(true, "done", true);
    expect(openedPiles()).toBe("backlog");
    expect(changed).toHaveBeenCalledTimes(3);
    window.removeEventListener("weft-board-prefs", changed);
  });

  it("reads nothing opened without a document", () => {
    vi.stubGlobal("document", undefined);
    expect(openedPiles()).toBe("");
    vi.unstubAllGlobals();
  });
});

describe("sidebarSections", () => {
  const card = (id: string, column: Card["column"]) => ({ id, column }) as Card;
  const byColumn = new Map<Column, Card[]>([
    ["needs_you", [card("a", "needs_you")]],
    ["running", [card("b", "running"), card("c", "running")]],
    ["done", [card("d", "done")]],
  ]);

  it("puts the three piles first, then Backlog and Done shut, with each column's cards", () => {
    const sections = sidebarSections(COLUMNS, byColumn, "");
    expect(sections.map((s) => [s.id, s.label, s.cards.length, s.strip, s.open])).toEqual([
      ["needs_you", "Needs you", 1, false, true],
      ["running", "Working", 2, false, true],
      ["review", "Ready", 0, false, true],
      ["backlog", "Backlog", 0, true, false],
      ["done", "Done", 1, true, false],
    ]);
  });

  it("opens a strip you opened and leaves out a column the board hides", () => {
    const sections = sidebarSections(COLUMNS.filter((c) => c.id !== "backlog"), byColumn, "done");
    expect(sections.map((s) => s.id)).toEqual(["needs_you", "running", "review", "done"]);
    expect(sections.at(-1)?.open).toBe(true);
  });
});

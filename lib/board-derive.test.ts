import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import { filterState, footerFor, headerCounts, menuProject, openCardOf, workFolder } from "./board-derive";

const card = (over: Partial<Card>): Card => ({ id: "a", cwd: "/card", backend: "claude", column: "running", ...over }) as Card;
const latest = { cwd: "/latest", backend: "codex" as const, model: "m" };

describe("filterState", () => {
  it("is not filtering with nothing set, and keys the view on every filter", () => {
    expect(filterState(null, "  ", {})).toEqual({ filtering: false, view: "\n\n" });
    expect(filterState("/p", " fix ", { starred: true, tag: "bug" })).toEqual({ filtering: true, view: "/p\nfix\n★bug" });
    expect(filterState(null, "q", {}).filtering).toBe(true);
    expect(filterState(null, "", { tag: "x" }).filtering).toBe(true);
  });
});

describe("footerFor", () => {
  it("shows the open card, and no card's numbers when none is open", () => {
    const open = card({ stats: { model: "o" } });
    expect(footerFor(open)).toEqual({ stats: open.stats, cwd: "/card", backend: "claude" });
    expect(footerFor(null)).toEqual({ stats: undefined, cwd: undefined, backend: undefined });
  });
});

describe("menuProject", () => {
  const rootOf = (cwd: string) => (cwd === "/p/.claude/worktrees/feat" ? "/p" : cwd);

  it("is the folder's main checkout", () => {
    expect(menuProject("/p", rootOf)).toBe("/p");
    expect(menuProject("/p/.claude/worktrees/feat", rootOf)).toBe("/p");
  });

  it("is null with no folder, or a scratch one", () => {
    expect(menuProject(null, rootOf)).toBeNull();
    expect(menuProject(undefined, rootOf)).toBeNull();
    expect(menuProject("", rootOf)).toBeNull();
    expect(menuProject("/tmp/x", rootOf)).toBeNull();
    expect(menuProject("/Users/a/.claude/worktrees/orphan", rootOf)).toBeNull();
  });
});

describe("workFolder", () => {
  it("prefers the open card, then the project, then the latest card", () => {
    expect(workFolder(card({}), "/p", latest)).toBe("/card");
    expect(workFolder(null, "/p", latest)).toBe("/p");
    expect(workFolder(null, null, latest)).toBe("/latest");
    expect(workFolder(null, null, undefined)).toBeUndefined();
  });
});

describe("openCardOf", () => {
  it("finds the selected card", () => {
    const cards = [card({ id: "a" }), card({ id: "b" })];
    expect(openCardOf(cards, null, "b")).toBe(cards[1]);
  });

  it("falls back to the copilot when its id is selected", () => {
    const copilot = card({ id: "copilot" });
    expect(openCardOf([card({ id: "a" })], copilot, "copilot")).toBe(copilot);
  });

  it("is null for an id that is neither", () => {
    expect(openCardOf([card({ id: "a" })], card({ id: "copilot" }), "zzz")).toBeNull();
  });

  it("is null for a null id and a null copilot", () => {
    expect(openCardOf([card({ id: "a" })], card({ id: "copilot" }), null)).toBeNull();
    expect(openCardOf([], null, "a")).toBeNull();
  });
});

describe("headerCounts", () => {
  it("counts unarchived running and needs-you cards", () => {
    const cards = [
      card({ column: "running" }),
      card({ column: "running", archived: true }),
      card({ column: "needs_you" }),
      card({ column: "needs_you" }),
      card({ column: "done" }),
    ];
    expect(headerCounts(cards)).toEqual({ running: 1, waiting: 2 });
  });
});

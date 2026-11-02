import { describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import { filterState, footerFor, framedCard, headerCounts, menuProject, openCardMarks, openCardOf, terminalAway, workFolder } from "./board-derive";
import type { WorkerProject } from "./worker-project";

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

describe("framedCard", () => {
  const mine = { id: "m1" } as Card;
  const theirs = { id: "w1" } as Card;

  it("is this Mac's open card, else the worker's, else none", () => {
    expect(framedCard(mine, { card: theirs })).toBe(mine);
    expect(framedCard(null, { card: theirs })).toBe(theirs);
    expect(framedCard(null, null)).toBeNull();
  });
});

describe("openCardMarks", () => {
  it("acts on the framed card, and does nothing with none", () => {
    const act = { star: vi.fn(), tags: vi.fn(), share: vi.fn(), archive: vi.fn() };
    const c = { id: "c1" } as Card;
    const marks = openCardMarks(c, act);
    marks.onStar();
    marks.onTags();
    marks.onShare();
    marks.onArchive();
    for (const fn of Object.values(act)) expect(fn).toHaveBeenCalledWith(c);
    const none = openCardMarks(null, act);
    none.onStar();
    expect(act.star).toHaveBeenCalledTimes(1);
  });
});


describe("terminalAway", () => {
  const projects = [{ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online" }] as WorkerProject[];
  it("names the open worker card's worker, else the chosen worker project's when no card is open", () => {
    expect(terminalAway({ name: "m2" }, "/r", projects, true)).toBe("m2");
    expect(terminalAway(null, "worker://w1/ling", projects, false)).toBe("m1mini");
    expect(terminalAway(null, "worker://w9/x", projects, false)).toBeNull();
  });

  it("is this Mac's terminal for a local card or project, or none", () => {
    expect(terminalAway(null, "worker://w1/ling", projects, true)).toBeNull();
    expect(terminalAway(undefined, null, projects, false)).toBeNull();
    expect(terminalAway(null, "/r", projects, false)).toBeNull();
  });

  it("says nothing where the drawer opens the worker's own terminal with a signed approval", () => {
    expect(terminalAway({ name: "m2" }, "/r", projects, true, true)).toBeNull();
    expect(terminalAway(null, "worker://w1/ling", projects, false, true)).toBeNull();
  });
});

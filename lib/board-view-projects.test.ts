import { describe, expect, it } from "vitest";
import { summarizeProjects } from "./board-view";
import type { Card, Project } from "./types";

// The project bar's rows (lib/board-view.ts summarizeProjects), apart from the rest of board-view's tests.

function card(overrides: Partial<Card> = {}): Card {
  const base: Card = {
    id: "c",
    title: "Untitled",
    prompt: "do the thing",
    cwd: "/repo",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
  return { ...base, ...overrides };
}

const identity = (cwd: string) => cwd;

describe("summarizeProjects", () => {
  it("gives a saved project with no cards a row using lastUsedAt as lastActivity", () => {
    const p: Project = { path: "/saved", lastUsedAt: 5000 };
    const rows = summarizeProjects([p], [], identity);
    expect(rows).toEqual([{ path: "/saved", lastActivity: 5000, cards: 0, running: 0, needsYou: 0 }]);
  });

  it("carries a saved project's pin and hide onto its row", () => {
    const rows = summarizeProjects([{ path: "/p", lastUsedAt: 1, pinned: true }, { path: "/h", lastUsedAt: 2, hidden: true }], [], identity);
    expect(rows).toEqual([
      { path: "/h", lastActivity: 2, cards: 0, running: 0, needsYou: 0, hidden: true },
      { path: "/p", lastActivity: 1, cards: 0, running: 0, needsYou: 0, pinned: true },
    ]);
  });

  it("folds two cwds that rootOf maps to the same path into one row with cards summed", () => {
    const rootOf = (cwd: string) => (cwd.startsWith("/repo") ? "/repo" : cwd);
    const main = card({ id: "main", cwd: "/repo", column: "running" });
    const wt = card({ id: "wt", cwd: "/repo/.claude/worktrees/x", column: "needs_you" });
    const rows = summarizeProjects([], [main, wt], rootOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "/repo", cards: 2, running: 1, needsYou: 1 });
  });

  it("counts running/needsYou only for those columns", () => {
    const rootOf = (cwd: string) => cwd;
    const cards = [
      card({ id: "r1", cwd: "/a", column: "running" }),
      card({ id: "ny1", cwd: "/a", column: "needs_you" }),
      card({ id: "rv", cwd: "/a", column: "review" }),
      card({ id: "dn", cwd: "/a", column: "done" }),
      card({ id: "bl", cwd: "/a", column: "backlog" }),
    ];
    const rows = summarizeProjects([], cards, rootOf);
    expect(rows[0]).toMatchObject({ path: "/a", cards: 5, running: 1, needsYou: 1 });
  });

  it("leaves archived cards out of running/needsYou but still counts them as cards", () => {
    const cards = [
      card({ id: "ny", cwd: "/a", column: "needs_you", archived: true }),
      card({ id: "r", cwd: "/a", column: "running", archived: true }),
    ];
    const rows = summarizeProjects([], cards, identity);
    expect(rows[0]).toMatchObject({ path: "/a", cards: 2, running: 0, needsYou: 0 });
  });

  it("sorts rows by lastActivity descending", () => {
    const rootOf = (cwd: string) => cwd;
    const fresh = card({ id: "f", cwd: "/fresh", lastActivity: 3000 });
    const mid = card({ id: "m", cwd: "/mid", lastActivity: 2000 });
    const old = card({ id: "o", cwd: "/old", lastActivity: 1000 });
    const rows = summarizeProjects([], [old, fresh, mid], rootOf);
    expect(rows.map((r) => r.path)).toEqual(["/fresh", "/mid", "/old"]);
  });

  it("uses lastActivity over updatedAt for a card's lastActivity in the summary", () => {
    const onlyUpdated = card({ id: "u", cwd: "/x", updatedAt: 500, lastActivity: undefined });
    const olderUpdatedButNewerActivity = card({ id: "n", cwd: "/y", updatedAt: 100, lastActivity: 900 });
    const rows = summarizeProjects([], [onlyUpdated, olderUpdatedButNewerActivity], identity);
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r.lastActivity]));
    expect(byPath["/x"]).toBe(500);
    expect(byPath["/y"]).toBe(900);
  });

  it("maxes a card's activity with the saved project's lastUsedAt", () => {
    const p: Project = { path: "/p", lastUsedAt: 10_000 };
    const c = card({ id: "c", cwd: "/p", lastActivity: 5_000 });
    const rows = summarizeProjects([p], [c], identity);
    expect(rows[0]!.lastActivity).toBe(10_000);
  });
});

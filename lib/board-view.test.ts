import { describe, expect, it } from "vitest";
import {
  activeAt,
  cardChangeEffects,
  groupByColumn,
  hitPlanLimit,
  latestLimits,
  OWN_MOVE_MS,
  SORTERS,
  stepThrough,
  topMatches,
  UNSEEN_COLUMNS,
} from "./board-view";
import { COLUMNS, type Card, type Column } from "./types";

// Every required Card field with a sensible default; tests override what they care about.
let cardSeq = 0;
function card(overrides: Partial<Card> = {}): Card {
  cardSeq += 1;
  const base: Card = {
    id: `c${cardSeq}`,
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

function view(overrides: Partial<Parameters<typeof groupByColumn>[1]> = {}) {
  return { project: null, query: "", sort: "newest" as const, showArchived: false, ...overrides };
}

const identity = (cwd: string) => cwd;
const NOW = 1_700_000_000_000;

describe("groupByColumn", () => {
  it("includes every COLUMNS id even when no cards are present", () => {
    const groups = groupByColumn([], view(), identity);
    expect([...groups.keys()]).toEqual(COLUMNS.map((c) => c.id));
    for (const list of groups.values()) expect(list).toEqual([]);
  });

  it("folds a worktree cwd into its project via rootOf", () => {
    const main = card({ id: "main", cwd: "/repo" });
    const worktree = card({ id: "wt", cwd: "/repo/.claude/worktrees/feat" });
    const other = card({ id: "other", cwd: "/other" });
    const rootOf = (cwd: string) => (cwd.startsWith("/repo") ? "/repo" : cwd);
    const groups = groupByColumn([main, worktree, other], view({ project: "/repo" }), rootOf);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["main", "wt"]);
  });

  it("excludes cards from other projects even when their column matches", () => {
    const a = card({ id: "a", cwd: "/a" });
    const b = card({ id: "b", cwd: "/b" });
    const groups = groupByColumn([a, b], view({ project: "/a" }), identity);
    expect(groups.get("backlog")).toEqual([a]);
  });

  it("hides archived cards unless showArchived is true", () => {
    const live = card({ id: "live" });
    const archived = card({ id: "old", archived: true });
    expect(groupByColumn([live, archived], view(), identity).get("backlog")?.map((c) => c.id)).toEqual(["live"]);
    expect(groupByColumn([live, archived], view({ showArchived: true }), identity).get("backlog")?.map((c) => c.id)).toEqual([
      "live",
      "old",
    ]);
  });

  it("trims the query and matches case-insensitively", () => {
    const hit = card({ id: "hit", title: "Fix the Login Bug" });
    const miss = card({ id: "miss", title: "Refactor" });
    const groups = groupByColumn([hit, miss], view({ query: "  LoGiN  " }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["hit"]);
  });

  it("matches against title, prompt, lastLine, stage, and remaining", () => {
    const byTitle = card({ id: "t", title: "alpha", prompt: "x", lastLine: "x", stage: "x", remaining: "x" });
    const byPrompt = card({ id: "p", title: "x", prompt: "alpha", lastLine: "x", stage: "x", remaining: "x" });
    const byLast = card({ id: "l", title: "x", prompt: "x", lastLine: "alpha", stage: "x", remaining: "x" });
    const byStage = card({ id: "s", title: "x", prompt: "x", lastLine: "x", stage: "alpha", remaining: "x" });
    const byRemaining = card({ id: "r", title: "x", prompt: "x", lastLine: "x", stage: "x", remaining: "alpha" });
    for (const c of [byTitle, byPrompt, byLast, byStage, byRemaining]) {
      const groups = groupByColumn([c], view({ query: "alpha" }), identity);
      expect(groups.get("backlog")).toEqual([c]);
    }
  });
  // Tag matching (`tag:foo`, and a card's tags as part of the free-text query) lives in
  // lib/board-view-tags.test.ts so this suite stays under its ratchet cap.

  it("a whitespace-only query matches everything", () => {
    const a = card({ id: "a" });
    const b = card({ id: "b", column: "running" });
    const groups = groupByColumn([a, b], view({ query: "   " }), identity);
    expect(groups.get("backlog")).toEqual([a]);
    expect(groups.get("running")).toEqual([b]);
  });

  it("sorts by createdAt descending under newest", () => {
    const old = card({ id: "old", createdAt: 100, updatedAt: 100 });
    const mid = card({ id: "mid", createdAt: 200, updatedAt: 200 });
    const fresh = card({ id: "fresh", createdAt: 300, updatedAt: 300 });
    const groups = groupByColumn([old, fresh, mid], view({ sort: "newest" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["fresh", "mid", "old"]);
  });

  it("sorts by createdAt ascending under oldest", () => {
    const old = card({ id: "old", createdAt: 100, updatedAt: 100 });
    const mid = card({ id: "mid", createdAt: 200, updatedAt: 200 });
    const fresh = card({ id: "fresh", createdAt: 300, updatedAt: 300 });
    const groups = groupByColumn([old, fresh, mid], view({ sort: "oldest" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["old", "mid", "fresh"]);
  });

  it("uses lastActivity over updatedAt for the active sort", () => {
    const onlyUpdated = card({ id: "u", createdAt: 0, updatedAt: 500, lastActivity: undefined });
    const onlyCreated = card({ id: "c", createdAt: 0, updatedAt: 0, lastActivity: 700 });
    const newerActivity = card({ id: "n", createdAt: 0, updatedAt: 1000, lastActivity: 900 });
    const groups = groupByColumn([onlyUpdated, onlyCreated, newerActivity], view({ sort: "active" }), identity);
    expect(groups.get("backlog")?.map((c) => c.id)).toEqual(["n", "c", "u"]);
  });

  it("places cards into the column their .column says, not by filter outcome", () => {
    const running = card({ id: "run", column: "running" });
    const review = card({ id: "rev", column: "review" });
    const groups = groupByColumn([running, review], view(), identity);
    expect(groups.get("running")).toEqual([running]);
    expect(groups.get("review")).toEqual([review]);
    expect(groups.get("backlog")).toEqual([]);
  });
});

describe("topMatches", () => {
  it("takes the most recently active cards across every column, up to the limit", () => {
    const old = card({ column: "done", updatedAt: 1 });
    const mid = card({ column: "running", updatedAt: 2 });
    const fresh = card({ column: "review", updatedAt: 1, lastActivity: 3 });
    const groups = groupByColumn([old, mid, fresh], view(), identity);
    expect(topMatches(groups, 2, "").map((m) => m.card)).toEqual([fresh, mid]);
  });
});

describe("hitPlanLimit", () => {
  it("is false when no card hit its plan limit", () => {
    expect(hitPlanLimit([card(), card({ rateLimitHit: false })])).toBe(false);
  });

  it("is true when a card on the board hit its plan limit", () => {
    expect(hitPlanLimit([card(), card({ rateLimitHit: true })])).toBe(true);
  });

  it("ignores archived cards", () => {
    expect(hitPlanLimit([card({ rateLimitHit: true, archived: true })])).toBe(false);
  });
});

describe("latestLimits", () => {
  it("returns undefined when no card has stats", () => {
    expect(latestLimits([card(), card()])).toBeUndefined();
  });

  it("returns the latest card's stats along with its cwd and backend", () => {
    const a = card({
      id: "a",
      updatedAt: 100,
      cwd: "/old",
      backend: "puku",
      stats: { model: "opus", fiveHour: { used: 10, resetsAt: 1 } },
    });
    const b = card({
      id: "b",
      updatedAt: 300,
      cwd: "/new",
      backend: "claude",
      stats: { model: "sonnet", fiveHour: { used: 30, resetsAt: 3 } },
    });
    const c = card({
      id: "c",
      updatedAt: 200,
      stats: { model: "haiku", fiveHour: { used: 50, resetsAt: 5 } },
    });
    const result = latestLimits([a, b, c]);
    expect(result).toEqual({ model: "sonnet", fiveHour: { used: 30, resetsAt: 3 }, cwd: "/new", backend: "claude" });
  });

  it("passes the latest card's full stats through (model, branch, tokens, lines, limits)", () => {
    const a = card({
      id: "a",
      updatedAt: 100,
      stats: {
        model: "opus",
        branch: "main",
        tokens: 12345,
        added: 12,
        removed: 3,
        fiveHour: { used: 1, resetsAt: 9 },
        sevenDay: { used: 2, resetsAt: 10 },
      },
    });
    expect(latestLimits([a])).toEqual({
      model: "opus",
      branch: "main",
      tokens: 12345,
      added: 12,
      removed: 3,
      fiveHour: { used: 1, resetsAt: 9 },
      sevenDay: { used: 2, resetsAt: 10 },
      cwd: "/repo",
      backend: "claude",
    });
  });

  it("returns whatever stats the latest card has, even without fiveHour or sevenDay", () => {
    const a = card({ id: "a", updatedAt: 100, stats: { model: "haiku" } });
    expect(latestLimits([a])).toEqual({ model: "haiku", cwd: "/repo", backend: "claude" });
  });
});

describe("stepThrough", () => {
  const opts = ["a", "b", "c"] as const;
  it("steps forward and wraps at the end", () => {
    expect(stepThrough(opts, "a", 1)).toBe("b");
    expect(stepThrough(opts, "b", 1)).toBe("c");
    expect(stepThrough(opts, "c", 1)).toBe("a");
  });
  it("steps backward and wraps at the start", () => {
    expect(stepThrough(opts, "a", -1)).toBe("c");
    expect(stepThrough(opts, "c", -1)).toBe("b");
  });
  it("treats a value not in the list as index 0", () => {
    expect(stepThrough(opts, "z", 1)).toBe("b");
    expect(stepThrough(opts, undefined as unknown as "a", 1)).toBe("b");
  });
  it("works with null as an option (the All projects entry)", () => {
    const projects: (string | null)[] = [null, "/a", "/b"];
    expect(stepThrough(projects, null, 1)).toBe("/a");
    expect(stepThrough(projects, "/b", 1)).toBe(null);
    expect(stepThrough(projects, "/a", -1)).toBe(null);
  });
});

describe("cardChangeEffects", () => {
  it("first sighting (previous undefined) sets off nothing, even with an error", () => {
    const fx = cardChangeEffects({
      previous: undefined,
      column: "needs_you",
      previousError: undefined,
      error: "boom",
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx).toEqual({ moved: false, chime: null, markUnseen: false, errorChime: false });
  });

  it("same column → not moved, no chime", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "running",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.moved).toBe(false);
    expect(fx.chime).toBeNull();
    expect(fx.markUnseen).toBe(false);
    expect(fx.errorChime).toBe(false);
  });

  it("a move to review chimes review", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "review",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.chime).toBe("review");
  });

  it("a move to needs_you chimes needs_you", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "needs_you",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.chime).toBe("needs_you");
  });

  it("a move to done chimes done", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "done",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.chime).toBe("done");
  });

  it("a move to running chimes running", () => {
    const fx = cardChangeEffects({
      previous: "backlog",
      column: "running",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.chime).toBe("running");
  });

  it("a move to backlog never chimes", () => {
    const fx = cardChangeEffects({
      previous: "review",
      column: "backlog",
      previousError: undefined,
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.chime).toBeNull();
    expect(fx.moved).toBe(true);
  });

  it("markUnseen only for needs_you/review/done and only when the card isn't open", () => {
    const targets: Column[] = ["needs_you", "review", "done"];
    const others: Column[] = ["running", "backlog"];
    for (const t of targets) {
      const closed = cardChangeEffects({
        previous: "backlog",
        column: t,
        previousError: undefined,
        error: undefined,
        own: undefined,
        now: NOW,
        open: false,
      });
      expect(closed.markUnseen).toBe(true);
      const opened = cardChangeEffects({
        previous: "backlog",
        column: t,
        previousError: undefined,
        error: undefined,
        own: undefined,
        now: NOW,
        open: true,
      });
      expect(opened.markUnseen).toBe(false);
    }
    for (const t of others) {
      const fx = cardChangeEffects({
        previous: "backlog",
        column: t,
        previousError: undefined,
        error: undefined,
        own: undefined,
        now: NOW,
        open: false,
      });
      expect(fx.markUnseen).toBe(false);
    }
  });

  it("an own move (own.column === column and recent) → moved but no chime and not unseen", () => {
    const fx = cardChangeEffects({
      previous: "backlog",
      column: "needs_you",
      previousError: undefined,
      error: undefined,
      own: { column: "needs_you", at: NOW - 100 },
      now: NOW,
      open: false,
    });
    expect(fx.moved).toBe(true);
    expect(fx.chime).toBeNull();
    expect(fx.markUnseen).toBe(false);
  });

  it("an own move that is too old still chimes", () => {
    const fx = cardChangeEffects({
      previous: "backlog",
      column: "needs_you",
      previousError: undefined,
      error: undefined,
      own: { column: "needs_you", at: NOW - OWN_MOVE_MS - 1 },
      now: NOW,
      open: false,
    });
    expect(fx.moved).toBe(true);
    expect(fx.chime).toBe("needs_you");
    expect(fx.markUnseen).toBe(true);
  });

  it("an own move to a different column still chimes (own.column !== column)", () => {
    const fx = cardChangeEffects({
      previous: "backlog",
      column: "review",
      previousError: undefined,
      error: undefined,
      own: { column: "needs_you", at: NOW - 100 },
      now: NOW,
      open: false,
    });
    expect(fx.moved).toBe(true);
    expect(fx.chime).toBe("review");
    expect(fx.markUnseen).toBe(true);
  });

  it("errorChime fires when there was a previous column and the error is new", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "running",
      previousError: undefined,
      error: "boom",
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.errorChime).toBe(true);
  });

  it("errorChime fires when the error changes", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "running",
      previousError: "first",
      error: "second",
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.errorChime).toBe(true);
  });

  it("errorChime does not fire when the error is unchanged", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "running",
      previousError: "same",
      error: "same",
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.errorChime).toBe(false);
  });

  it("errorChime does not fire when the error is cleared", () => {
    const fx = cardChangeEffects({
      previous: "running",
      column: "running",
      previousError: "had it",
      error: undefined,
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.errorChime).toBe(false);
  });

  it("errorChime does not fire on first sighting (previous undefined), even with an error", () => {
    const fx = cardChangeEffects({
      previous: undefined,
      column: "running",
      previousError: undefined,
      error: "boom",
      own: undefined,
      now: NOW,
      open: false,
    });
    expect(fx.errorChime).toBe(false);
  });
});

describe("exported helpers", () => {
  it("activeAt uses lastActivity when present, else updatedAt", () => {
    expect(activeAt(card({ updatedAt: 100, lastActivity: 200 }))).toBe(200);
    expect(activeAt(card({ updatedAt: 100 }))).toBe(100);
  });
  it("UNSEEN_COLUMNS are the ones the user is expected to look at", () => {
    expect(UNSEEN_COLUMNS).toEqual(["needs_you", "review", "done"]);
  });
  it("SORTERS expose one entry per SortKey", () => {
    expect(Object.keys(SORTERS).sort()).toEqual(["active", "newest", "oldest"]);
  });
});

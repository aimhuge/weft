import { describe, expect, it } from "vitest";
import { cardLooksLikeError, cardLooksLikeSessionLimit, groupByColumn, reviewFilterCounts, reviewKeeps } from "./board-view";
import type { Card } from "./types";

// Review's Errors and Restart chips, with the last lines real threads ended on.
const THREAD_ERROR = "error: Claude Code process exited with code 1";
const BUILD_ERROR = "Build error in ./components/Confetti.tsx";
const SESSION_LIMIT = "You've hit your session limit · resets 10:40pm (Asia/Bangkok)";
const NORMAL = "Added the chips and their tests.";

let seq = 0;
function card(lastLine: string | undefined, over: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `r${seq}`, title: `card ${seq}`, prompt: "p", cwd: "/repo", backend: "claude", permissionMode: "default",
    column: "review", createdAt: seq, updatedAt: seq, lastLine, ...over,
  };
}

const view = (reviewFilter?: { errors: boolean; restart: boolean }) => ({ project: null, query: "", sort: "newest" as const, showArchived: false, reviewFilter });
const ids = (cards: Card[] | undefined) => (cards ?? []).map((c) => c.lastLine);

describe("the Review column's order", () => {
  it("puts the most recently updated card on top, whatever the board's sort", () => {
    const stale = card("stale", { createdAt: 300, updatedAt: 10 });
    const fresh = card("fresh", { createdAt: 100, updatedAt: 50 });
    const picked = card("picked", { createdAt: 200, updatedAt: 5, lastActivity: 30 });
    for (const sort of ["newest", "oldest", "active"] as const) {
      const groups = groupByColumn([stale, fresh, picked], { ...view(), sort }, (c) => c);
      expect(ids(groups.get("review"))).toEqual(["fresh", "picked", "stale"]);
    }
  });
});

describe("cardLooksLikeError", () => {
  it("matches a thread error and a build error", () => {
    expect(cardLooksLikeError(card(THREAD_ERROR))).toBe(true);
    expect(cardLooksLikeError(card(BUILD_ERROR))).toBe(true);
  });

  it("passes over a normal line, the session limit and a card with no line", () => {
    expect(cardLooksLikeError(card(NORMAL))).toBe(false);
    expect(cardLooksLikeError(card(SESSION_LIMIT))).toBe(false);
    expect(cardLooksLikeError(card(undefined))).toBe(false);
  });
});

describe("cardLooksLikeSessionLimit", () => {
  it("matches the 5-hour session limit", () => {
    expect(cardLooksLikeSessionLimit(card(SESSION_LIMIT))).toBe(true);
  });

  it("passes over errors, a normal line and no line", () => {
    expect(cardLooksLikeSessionLimit(card(THREAD_ERROR))).toBe(false);
    expect(cardLooksLikeSessionLimit(card(NORMAL))).toBe(false);
    expect(cardLooksLikeSessionLimit(card(undefined))).toBe(false);
  });
});

describe("reviewKeeps", () => {
  it("keeps everything with no filter or no chip on", () => {
    expect(reviewKeeps()(card(NORMAL))).toBe(true);
    expect(reviewKeeps({ errors: false, restart: false })(card(NORMAL))).toBe(true);
  });
});

describe("groupByColumn with Review's chips", () => {
  const cards = [card(NORMAL), card(THREAD_ERROR), card(SESSION_LIMIT), card(BUILD_ERROR), card(THREAD_ERROR, { column: "running" })];

  it("shows every Review card with the chips off", () => {
    expect(groupByColumn(cards, view(), (c) => c).get("review")).toHaveLength(4);
  });

  it("Errors keeps only errored Review cards, newest first", () => {
    expect(ids(groupByColumn(cards, view({ errors: true, restart: false }), (c) => c).get("review"))).toEqual([BUILD_ERROR, THREAD_ERROR]);
  });

  it("Restart keeps only session-limit Review cards", () => {
    expect(ids(groupByColumn(cards, view({ errors: false, restart: true }), (c) => c).get("review"))).toEqual([SESSION_LIMIT]);
  });

  it("both on keeps either kind", () => {
    expect(groupByColumn(cards, view({ errors: true, restart: true }), (c) => c).get("review")).toHaveLength(3);
  });

  it("leaves other columns alone", () => {
    const running = [card(NORMAL, { column: "running" })];
    expect(groupByColumn(running, view({ errors: true, restart: true }), (c) => c).get("running")).toHaveLength(1);
  });
});

describe("reviewFilterCounts", () => {
  it("counts each chip's matches", () => {
    expect(reviewFilterCounts([card(NORMAL), card(THREAD_ERROR), card(BUILD_ERROR), card(SESSION_LIMIT)])).toEqual({ errors: 2, restart: 1 });
  });
});

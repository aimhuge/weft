import { describe, expect, it } from "vitest";
import {
  AROUND_MS,
  blocked,
  counted,
  EMPTY_STATE,
  isCheckIn,
  landedText,
  localDay,
  markLanded,
  MAX_PER_DAY,
  MIN_GAP_MS,
  morningDue,
  morningText,
  SETTLE_MS,
  settledMove,
  shownText,
  today,
  waitingIdea,
  worthALook,
  type InitiativeState,
} from "./copilot-initiative";
import type { ThreadItem } from "./types";

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m);
const idle = { busy: false, items: [] as ThreadItem[] };

describe("today", () => {
  it("keeps the count within a day and resets it when the day turns", () => {
    const s: InitiativeState = { ...EMPTY_STATE, day: "2026-10-27", count: 2 };
    expect(today(s, at(10)).count).toBe(2);
    expect(today(s, new Date(2026, 9, 28, 9))).toMatchObject({ day: "2026-10-28", count: 0 });
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("blocked", () => {
  it("lets a check-in out on a quiet day in working hours", () => {
    expect(blocked(EMPTY_STATE, at(10), idle)).toBeNull();
  });

  it("keeps quiet from 21:00 to 7:00", () => {
    expect(blocked(EMPTY_STATE, at(6, 59), idle)).toBe("quiet hours");
    expect(blocked(EMPTY_STATE, at(21), idle)).toBe("quiet hours");
    expect(blocked(EMPTY_STATE, at(7), idle)).toBeNull();
  });

  it("stops at the daily cap and between close check-ins", () => {
    expect(blocked({ ...EMPTY_STATE, day: "2026-10-27", count: MAX_PER_DAY }, at(12), idle)).toBe("daily cap");
    expect(blocked({ ...EMPTY_STATE, lastAt: at(12).getTime() - MIN_GAP_MS + 1 }, at(12), idle)).toBe("too soon");
  });

  it("waits while the copilot is busy or an idea of its own is still unanswered", () => {
    expect(blocked(EMPTY_STATE, at(10), { busy: true, items: [] })).toBe("copilot busy");
    const items: ThreadItem[] = [
      { kind: "user", text: "☀️ Morning check-in", at: 1 },
      { kind: "assistant", text: "Build the diff view.", at: 2 },
    ];
    expect(blocked(EMPTY_STATE, at(10), { busy: false, items })).toBe("an idea is still waiting");
  });
});

describe("waitingIdea", () => {
  it("is the last message being a check-in, not one you wrote", () => {
    expect(waitingIdea([])).toBe(false);
    expect(waitingIdea([{ kind: "user", text: "🔧 Refactor check-in: weft", at: 1 }])).toBe(true);
    expect(
      waitingIdea([
        { kind: "user", text: "☀️ Morning check-in", at: 1 },
        { kind: "user", text: "sounds good", at: 2 },
        { kind: "assistant", text: "ok", at: 3 },
      ]),
    ).toBe(false);
  });
});

describe("shownText and isCheckIn", () => {
  it("labels a check-in, with its project when it has one", () => {
    expect(shownText("morning")).toBe("☀️ Morning check-in");
    expect(shownText("landed", "/dev/weft")).toBe("🔧 Refactor check-in: weft");
    expect(isCheckIn("🔧 Refactor check-in: weft")).toBe(true);
    expect(isCheckIn("what next?")).toBe(false);
  });
});

describe("morningText and landedText", () => {
  it("asks the morning question with the projects and analytics, and the rules", () => {
    const text = morningText(["weft", "blastcp"]);
    expect(text).toMatch(/^\[Weft check-in: morning, not written by the user\]/);
    expect(text).toContain("Projects: weft, blastcp.");
    expect(text).toContain("analytics");
    expect(text).toContain("reply with exactly QUIET");
    expect(text).toContain("Don't open anything in the browser pane");
    expect(morningText([])).toContain("the projects on the board");
  });

  it("asks for one refactor about the commits that landed, with the scout's findings", () => {
    const text = landedText("/dev/weft", ["- feat: fold columns"], ["- Board.tsx Long Function: split it"]);
    expect(text).toContain("landed in /dev/weft:\n- feat: fold columns");
    expect(text).toContain("Refactor scout findings still open there:\n- Board.tsx Long Function: split it");
    expect(landedText("/r", [], [])).not.toContain("scout findings");
  });
});

describe("worthALook", () => {
  it("drops changelog, release, merge and wip bookkeeping", () => {
    expect(worthALook(["docs(changelog): x", "chore(release): 0.6.3", "Merge branch 'a'", "wip: park", "chore(migrations): stamp", "feat(board): fold"])).toEqual([
      "feat(board): fold",
    ]);
  });
});

describe("settledMove", () => {
  const base: InitiativeState = { ...EMPTY_STATE, heads: { "/a": "h1" } };

  it("records a project it hasn't seen without a check-in", () => {
    const r = settledMove(EMPTY_STATE, { "/a": "h1" }, 0);
    expect(r.state.heads).toEqual({ "/a": "h1" });
    expect(r.landed).toBeUndefined();
  });

  it("waits for a moved HEAD to settle, then names it", () => {
    const first = settledMove(base, { "/a": "h2" }, 1000);
    expect(first.landed).toBeUndefined();
    expect(first.state.moved).toEqual({ "/a": { head: "h2", at: 1000 } });
    expect(settledMove(first.state, { "/a": "h2" }, 1000 + SETTLE_MS - 1).landed).toBeUndefined();
    expect(settledMove(first.state, { "/a": "h2" }, 1000 + SETTLE_MS).landed).toEqual({ root: "/a", from: "h1", head: "h2" });
  });

  it("starts the wait again when HEAD moves again, and forgets a move that went back", () => {
    const first = settledMove(base, { "/a": "h2" }, 0);
    expect(settledMove(first.state, { "/a": "h3" }, SETTLE_MS).state.moved).toEqual({ "/a": { head: "h3", at: SETTLE_MS } });
    expect(settledMove(first.state, { "/a": "h1" }, SETTLE_MS).state.moved).toEqual({});
  });
});

describe("markLanded and counted", () => {
  it("makes the landed HEAD the new baseline", () => {
    const s = markLanded({ ...EMPTY_STATE, heads: { "/a": "h1" }, moved: { "/a": { head: "h2", at: 0 } } }, "/a", "h2");
    expect(s.heads).toEqual({ "/a": "h2" });
    expect(s.moved).toEqual({});
  });

  it("counts a check-in, and marks the morning one's day", () => {
    const s = counted(EMPTY_STATE, at(9), "morning");
    expect(s).toMatchObject({ day: "2026-10-27", count: 1, lastAt: at(9).getTime(), morningDay: "2026-10-27" });
    expect(counted(s, at(12), "landed")).toMatchObject({ count: 2, morningDay: "2026-10-27" });
  });
});

describe("morningDue", () => {
  it("is due once a day, only while you're at work", () => {
    const now = at(9);
    expect(morningDue(EMPTY_STATE, now, now.getTime() - 1000)).toBe(true);
    expect(morningDue(EMPTY_STATE, now, now.getTime() - AROUND_MS)).toBe(false);
    expect(morningDue({ ...EMPTY_STATE, morningDay: "2026-10-27" }, now, now.getTime())).toBe(false);
  });
});

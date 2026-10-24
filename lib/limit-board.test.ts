import { describe, expect, it } from "vitest";
import { boardValue, burnLabel, isLimitBoard, LIMIT_BOARDS, limitEntry, toLimitBoardView } from "./limit-board";

describe("limitEntry", () => {
  it("posts the fastest burns with their dates, and the counts", () => {
    const at = Date.UTC(2026, 9, 20, 3);
    expect(limitEntry({ fiveHour: 12, sevenDay: 2, fastest: { fiveHour: { ms: 1800000.4, at } } })).toEqual({
      fiveMs: 1800000, fiveAt: "2026-10-20T03:00:00.000Z", weekMs: null, weekAt: null, fiveHits: 12, weekHits: 2,
    });
    expect(limitEntry({ fiveHour: 0, sevenDay: 1, fastest: { sevenDay: { ms: 86400000, at } } })).toMatchObject({ fiveMs: null, weekMs: 86400000 });
    expect(limitEntry({ fiveHour: 0, sevenDay: 0 })).toMatchObject({ fiveMs: null, fiveAt: null, weekMs: null });
  });
});

describe("toLimitBoardView", () => {
  it("reads the rows, bigint values arriving as text", () => {
    const view = toLimitBoardView("seven_day", [
      { rank: 1, user_id: "u1", name: "", avatar_url: null, username: null, value: "86400000", at: "2026-10-20T03:00:00Z", is_me: false },
      { rank: 2, user_id: "u2", name: "Alex", avatar_url: "a.png", username: "fotoflo", value: 9, at: null, is_me: true },
    ]);
    expect(view).toEqual({
      state: "ready",
      board: "seven_day",
      rows: [
        { rank: 1, userId: "u1", name: "Builder", avatar: null, username: null, value: 86400000, at: Date.UTC(2026, 9, 20, 3), isMe: false },
        { rank: 2, userId: "u2", name: "Alex", avatar: "a.png", username: "fotoflo", value: 9, at: null, isMe: true },
      ],
    });
  });
});

describe("labels", () => {
  it("shows a burn in its largest units", () => {
    expect(burnLabel(9 * 60000)).toBe("9m");
    expect(burnLabel(72 * 60000)).toBe("1h 12m");
    expect(burnLabel(120 * 60000)).toBe("2h");
    expect(burnLabel((3 * 1440 + 4 * 60) * 60000)).toBe("3d 4h");
    expect(burnLabel(2 * 1440 * 60000)).toBe("2d");
  });

  it("shows a count board as a number", () => {
    expect(boardValue("five_hour_hits", 1200)).toBe("1,200");
    expect(boardValue("five_hour", 72 * 60000)).toBe("1h 12m");
  });

  it("knows its boards", () => {
    expect(LIMIT_BOARDS.map((b) => b.id)).toEqual(["five_hour", "seven_day", "five_hour_hits", "seven_day_hits"]);
    expect(isLimitBoard("five_hour")).toBe(true);
    expect(isLimitBoard("xp")).toBe(false);
    expect(isLimitBoard(null)).toBe(false);
  });
});

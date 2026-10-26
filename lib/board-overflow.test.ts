import { describe, expect, it } from "vitest";
import { wideColumns, type LaneSize } from "./board-overflow";

// Five open columns take 24 + 5 x 264 + 4 x 12 = 1392px; each wide one adds 276. 700px tall fits 8 cards.
const lanes = (counts: number[], folded: number[] = []): LaneSize[] =>
  (["backlog", "running", "needs_you", "review", "done"] as const).map((id, i) => ({ id, count: counts[i] ?? 0, folded: folded.includes(i) }));

describe("wideColumns", () => {
  it("widens nothing when the board has no room for another column", () => {
    expect(wideColumns(1280, 700, lanes([28, 2, 1, 9, 40]))).toEqual([]);
    expect(wideColumns(0, 0, lanes([28]))).toEqual([]);
  });

  it("widens the fullest column first, then the next while there's room", () => {
    expect(wideColumns(1392 + 276, 700, lanes([28, 2, 1, 9, 40]))).toEqual(["done"]);
    expect(wideColumns(1392 + 2 * 276, 700, lanes([28, 2, 1, 9, 40]))).toEqual(["done", "backlog"]);
    expect(wideColumns(1392 + 3 * 276, 700, lanes([28, 2, 1, 9, 40]))).toEqual(["done", "backlog", "review"]);
  });

  it("leaves a column whose cards fit its height, and every one after it", () => {
    expect(wideColumns(4000, 700, lanes([28, 2, 1, 8, 40]))).toEqual(["done", "backlog"]);
    expect(wideColumns(4000, 100, lanes([0, 2, 1, 0, 0]))).toEqual(["running"]);
  });

  it("keeps the board's order between columns with as many cards", () => {
    expect(wideColumns(1392 + 276, 700, lanes([9, 0, 0, 9, 0]))).toEqual(["backlog"]);
  });

  it("counts a folded column as its strip, and never widens it", () => {
    // Done and Backlog folded: 24 + 3 x 264 + 2 x 32 + 4 x 12 = 928px.
    expect(wideColumns(928 + 276, 700, lanes([28, 2, 1, 9, 40], [0, 4]))).toEqual(["review"]);
  });
});

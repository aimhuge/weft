import { describe, expect, it } from "vitest";
import { mergeTeamBoard, teamMacLabel } from "./team-board-types";
import type { Card } from "./types";

const card = (id: string, title = id) => ({ id, title }) as Card;

describe("teamMacLabel", () => {
  it("names the Mac by the first name", () => {
    expect(teamMacLabel({ name: "Zulker Nayeen" })).toBe("Zulker's Mac");
    expect(teamMacLabel({ name: "  " })).toBe("A teammate's Mac");
  });
});

describe("mergeTeamBoard", () => {
  const prev = { signedIn: true, cards: [card("a"), card("b"), card("c")], asOf: "t1" };

  it("takes a whole read as it is", () => {
    const next = { signedIn: true, cards: [card("z")] };
    expect(mergeTeamBoard(prev, next)).toBe(next);
  });

  it("lays a changed read over the last: newer rows replace, removed ones go", () => {
    const merged = mergeTeamBoard(prev, { signedIn: true, cards: [card("b", "B2")], delta: true, removed: ["c"], asOf: "t2" });
    expect(merged.cards.map((c) => c.title)).toEqual(["a", "B2"]);
    expect(merged.asOf).toBe("t2");
  });

  it("keeps the last asOf when the changed read has none", () => {
    expect(mergeTeamBoard(prev, { signedIn: true, cards: [], delta: true }).asOf).toBe("t1");
  });
});

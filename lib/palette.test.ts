import { describe, expect, it } from "vitest";
import { type PaletteItem, paletteResults, RECENT_MORE_ID, score } from "./palette";

const item = (id: string, group: PaletteItem["group"], label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  group,
  label,
  icon: "search",
  run: () => {},
  ...extra,
});
const none = { query: "", items: [] as PaletteItem[] };

describe("score", () => {
  it("ranks a word-start match above a mid-word match above a detail match", () => {
    expect(score(item("1", "Cards", "open board"), ["open"])).toBe(0);
    expect(score(item("1", "Cards", "open board"), ["board"])).toBe(0);
    expect(score(item("1", "Cards", "reopen"), ["open"])).toBe(1);
    expect(score(item("1", "Cards", "x", { detail: "alpha", keywords: "beta" }), ["beta"])).toBe(3);
  });
  it("is null when any word is missing", () => expect(score(item("1", "Cards", "a"), ["a", "zzz"])).toBeNull());
});

describe("paletteResults", () => {
  const items = [
    item("m", "Recently changed", "moved", { cardId: "c1" }),
    item("c1", "Cards", "moved", { cardId: "c1", root: "/a" }),
    ...Array.from({ length: 8 }, (_, i) => item(`k${i}`, "Cards", `card ${i}`, { cardId: `k${i}`, root: i === 0 ? "/b" : "/a" })),
    item("cmd", "Commands", "new card"),
    item("p", "Projects", "weft"),
  ];

  it("shows recents, commands, projects and the latest cards with nothing typed", () => {
    const ids = paletteResults(items, "  ", none, null).map((i) => i.id);
    expect(ids).toEqual(["m", "cmd", "p", "k0", "k1", "k2", "k3", "k4", "k5"]);
  });

  it("stays inside the scope, keeping unscoped items", () => {
    const ids = paletteResults(items, "", none, "/a").map((i) => i.id);
    expect(ids).not.toContain("k0");
    expect(ids).toContain("cmd");
  });

  it("ranks hits per group and adds prompts only for the current query", () => {
    const prompt = item("pr", "Prompts", "prompt", { root: "/a" });
    const out = paletteResults(items, "card", { query: "card", items: [prompt] }, null).map((i) => i.id);
    expect(out[0]).toBe("cmd");
    expect(out).toContain("pr");
    expect(paletteResults(items, "card", { query: "old", items: [prompt] }, null).map((i) => i.id)).not.toContain("pr");
  });

  it("shows five recent moves and a row for the rest, all of them once expanded", () => {
    const moves = Array.from({ length: 8 }, (_, i) => item(`r${i}`, "Recently changed", `moved ${i}`, { cardId: `k${i}` }));
    const cards = Array.from({ length: 8 }, (_, i) => item(`k${i}`, "Cards", `card ${i}`, { cardId: `k${i}` }));
    const folded = paletteResults([...moves, ...cards], "", none, null);
    expect(folded.slice(0, 6).map((i) => i.id)).toEqual(["r0", "r1", "r2", "r3", "r4", RECENT_MORE_ID]);
    expect(folded[5]?.label).toBe("Show 3 more");
    expect(folded.filter((i) => i.group === "Cards").map((i) => i.id)).toEqual(["k5", "k6", "k7"]);
    const open = paletteResults([...moves, ...cards], "", none, null, true);
    expect(open.map((i) => i.id)).toEqual(moves.map((i) => i.id));
  });

  it("has no show-more row when every recent move fits", () => {
    expect(paletteResults(items, "", none, null).map((i) => i.id)).not.toContain(RECENT_MORE_ID);
  });

  it("caps cards at 30", () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`x${i}`, "Cards", `thing ${i}`));
    expect(paletteResults(many, "thing", none, null)).toHaveLength(30);
  });
});

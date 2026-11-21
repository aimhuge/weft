import { describe, expect, it, vi } from "vitest";
import { addTag, cardTags, deleteTagQuestion, filterCards, isFiltering, railPinned, removeTag, setRailPinned, starredCount, tagColor, tagColors, tagList, tagSuggestions, toggleTag } from "./rail-view";
import { MAX_TAGS, tagHue } from "./tags";

const cards = [
  { id: "a", starred: true, tags: ["bug", "ui"] },
  { id: "b", tags: ["bug"] },
  { id: "c", starred: true },
  { id: "d" },
];
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe("filterCards", () => {
  it("narrows by person and machine when it's told whose each card is", () => {
    const place = (c: { id: string }) => ({ who: c.id === "a" ? "u2" : "me", on: c.id === "b" ? "worker:w" : "here" });
    expect(ids(filterCards(cards, { who: "u2" }, place))).toEqual(["a"]);
    expect(ids(filterCards(cards, { who: "me", on: "here" }, place))).toEqual(["c", "d"]);
    expect(ids(filterCards(cards, { on: "worker:w", tag: "bug" }, place))).toEqual(["b"]);
    // Without a way to place cards, who and on don't narrow anything.
    expect(filterCards(cards, { who: "u2" })).toBe(cards);
    expect(isFiltering({ who: "u2" })).toBe(true);
    expect(isFiltering({ on: "here" })).toBe(true);
  });

  it("shows every card with no filter", () => {
    expect(filterCards(cards, {})).toBe(cards);
    expect(filterCards(cards, { starred: false, tag: "" })).toBe(cards);
  });

  it("narrows to starred cards, a tag, or both", () => {
    expect(ids(filterCards(cards, { starred: true }))).toEqual(["a", "c"]);
    expect(ids(filterCards(cards, { tag: "bug" }))).toEqual(["a", "b"]);
    expect(ids(filterCards(cards, { starred: true, tag: "bug" }))).toEqual(["a"]);
    expect(filterCards(cards, { tag: "nope" })).toEqual([]);
  });
});

describe("isFiltering", () => {
  it("is on with ★ or a tag", () => {
    expect(isFiltering({})).toBe(false);
    expect(isFiltering({ starred: true })).toBe(true);
    expect(isFiltering({ tag: "ui" })).toBe(true);
  });
});

describe("toggleTag", () => {
  it("filters to a tag, clears it the second time, and keeps ★", () => {
    expect(toggleTag({ starred: true }, "ui")).toEqual({ starred: true, tag: "ui" });
    expect(toggleTag({ tag: "ui" }, "bug")).toEqual({ tag: "bug" });
    expect(toggleTag({ starred: true, tag: "ui" }, "ui")).toEqual({ starred: true, tag: undefined });
  });
});

describe("starredCount", () => {
  it("counts starred cards still on the board", () => {
    expect(starredCount([{ starred: true }, { starred: true, archived: true }, {}, { starred: false }])).toBe(1);
  });
});

describe("addTag", () => {
  it("adds a normalized tag", () => {
    expect(addTag(["bug"], "  #UI  Polish ")).toEqual(["bug", "ui polish"]);
    expect(addTag(undefined, "bug")).toEqual(["bug"]);
  });

  it("changes nothing for an empty, repeated or one-too-many tag", () => {
    expect(addTag(["bug"], " # ")).toBeUndefined();
    expect(addTag(["bug"], "BUG")).toBeUndefined();
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(addTag(full, "more")).toBeUndefined();
  });
});

describe("removeTag", () => {
  it("drops the tag", () => {
    expect(removeTag(["bug", "ui"], "bug")).toEqual(["ui"]);
    expect(removeTag(undefined, "bug")).toEqual([]);
  });
});

describe("tagSuggestions", () => {
  const all = [
    { tag: "bug", count: 5 },
    { tag: "debug", count: 3 },
    { tag: "ui", count: 2 },
    { tag: "build", count: 1 },
  ];

  it("offers tags the card doesn't have, prefix matches first", () => {
    expect(tagSuggestions(all, ["ui"], "bu")).toEqual(["bug", "build", "debug"]);
    expect(tagSuggestions(all, [], "ug")).toEqual(["bug", "debug"]);
    expect(tagSuggestions(all, ["bug"], "")).toEqual(["debug", "ui", "build"]);
    expect(tagSuggestions(all, [], "#B", 1)).toEqual(["bug"]);
  });
});

describe("tagList", () => {
  const board = [{ tags: ["bug", "ui"] }, { tags: ["bug"] }, {}];

  it("counts the board's tags without a catalog", () => {
    expect(tagList(null, board)).toEqual([
      { name: "bug", count: 2 },
      { name: "ui", count: 1 },
    ]);
  });

  it("keeps the catalog's tags and colours, even on no card", () => {
    expect(tagList([{ name: "ui", color: "1d76db" }, { name: "docs" }], board)).toEqual([
      { name: "bug", count: 2 },
      { name: "ui", color: "1d76db", count: 1 },
      { name: "docs", count: 0 },
    ]);
  });

  it("puts equal counts in name order", () => {
    expect(tagList([{ name: "b" }, { name: "a" }], []).map((t) => t.name)).toEqual(["a", "b"]);
  });
});

describe("tagColor", () => {
  it("uses the catalog's hex, with or without #", () => {
    expect(tagColor("bug", "d73a4a")).toBe("#d73a4a");
    expect(tagColor("bug", "#FFF")).toBe("#FFF");
  });

  it("falls back to the tag's hue", () => {
    expect(tagColor("bug")).toBe(`hsl(${tagHue("bug")} 55% 50%)`);
    expect(tagColor("bug", "red; x")).toBe(`hsl(${tagHue("bug")} 55% 50%)`);
  });

  it("maps every tag", () => {
    expect(tagColors([{ name: "a", color: "000000" }, { name: "b" }])).toEqual({ a: "#000000", b: tagColor("b") });
  });
});

describe("cardTags", () => {
  it("shows two and counts the rest", () => {
    expect(cardTags(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], more: 2 });
    expect(cardTags(["a"])).toEqual({ shown: ["a"], more: 0 });
    expect(cardTags(undefined, 1)).toEqual({ shown: [], more: 0 });
  });
});

describe("deleteTagQuestion", () => {
  it("says how many cards lose it", () => {
    expect(deleteTagQuestion("bug", 3)).toBe("Delete the tag “bug”? 3 cards will lose it.");
    expect(deleteTagQuestion("bug", 1)).toBe("Delete the tag “bug”? 1 card will lose it.");
    expect(deleteTagQuestion("bug", 0)).toBe("Delete the tag “bug”?");
  });
});

describe("railPinned", () => {
  it("is off with no storage, and remembers what you set", () => {
    expect(railPinned()).toBe(false);
    setRailPinned(true);
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    setRailPinned(true);
    expect(railPinned()).toBe(true);
    setRailPinned(false);
    expect(railPinned()).toBe(false);
    vi.unstubAllGlobals();
  });
});

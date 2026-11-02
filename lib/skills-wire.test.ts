import { describe, expect, it, vi } from "vitest";
import { SKILLS_BUDGET, SKILLS_FRESH_MS, fitSkills, jsonbBytes, readSkills, skillCache } from "./skills-wire";
import type { SkillInfo } from "./types";

const skill = (i: number, description = "d".repeat(200)): SkillInfo => ({ name: `skill-${i}`, description, source: "user" });
const size = (v: unknown) => jsonbBytes(v);

describe("fitSkills", () => {
  it("sends a short list whole, as triples", () => {
    expect(fitSkills([{ name: "ship", description: "Ship it", source: "project" }])).toEqual({ skills: [["ship", "Ship it", "project"]] });
  });

  it("shortens the descriptions until the list fits, with an ellipsis", () => {
    const wire = fitSkills(Array.from({ length: 30 }, (_, i) => skill(i)));
    expect(size(wire)).toBeLessThanOrEqual(SKILLS_BUDGET);
    expect(wire.skills).toHaveLength(30);
    expect(wire.more).toBeUndefined();
    const description = wire.skills[0]![1];
    expect(description.endsWith("…")).toBe(true);
    expect(description.length).toBeLessThan(120);
  });

  it("drops the descriptions, then cuts the list and counts what it left out", () => {
    const many = Array.from({ length: 400 }, (_, i) => skill(i));
    const wire = fitSkills(many);
    expect(size(wire)).toBeLessThanOrEqual(SKILLS_BUDGET);
    expect(wire.skills.every(([, d]) => d === "")).toBe(true);
    expect(wire.skills.length + (wire.more ?? 0)).toBe(400);
    expect(wire.more).toBeGreaterThan(0);
  });

  it("keeps a description shorter than the cut as it is, and leaves no ellipsis on an empty cut", () => {
    const some = fitSkills(Array.from({ length: 30 }, (_, i) => skill(i, i ? "x".repeat(200) : "short")));
    expect(some.skills[0]![1]).toBe("short");
    expect(some.skills[1]![1].endsWith("…")).toBe(true);
    const lots = fitSkills(Array.from({ length: 70 }, (_, i) => skill(i)));
    expect(lots.skills.every(([, d]) => d === "")).toBe(true);
    expect(lots.more).toBeUndefined();
  });
});

describe("readSkills", () => {
  it("reads the triples back, dropping malformed rows", () => {
    const result = { ok: true, skills: [["ship", "Ship it", "project"], ["", "x", "user"], ["a", 1, "user"], ["b", "", "elsewhere"], "c", ["d", "", "weft"]] };
    expect(readSkills(result)).toEqual([
      { name: "ship", description: "Ship it", source: "project" },
      { name: "d", description: "", source: "weft" },
    ]);
  });

  it("is empty for a result with no list", () => {
    expect(readSkills(null)).toEqual([]);
    expect(readSkills("x")).toEqual([]);
    expect(readSkills({ ok: true })).toEqual([]);
  });
});

describe("jsonbBytes", () => {
  it("counts from above what Postgres stores: headers, JEntries, padding, and the strings themselves", () => {
    expect(jsonbBytes("abc")).toBe(7);
    expect(jsonbBytes(1)).toBe(16);
    expect(jsonbBytes(null)).toBe(4);
    expect(jsonbBytes(true)).toBe(4);
    // [ "ab", "" ]: varlena 4, header 4, two JEntries 8, 2 bytes of text.
    expect(jsonbBytes(["ab", ""])).toBe(18);
    // { k: [] }: varlena 4, header 4, key and value JEntries 8, "k" 1, padding 3, the empty array's header 4.
    expect(jsonbBytes({ k: [], gone: undefined })).toBe(24);
  });

  it("keeps the largest fitted list, with result's own keys, under the column's 4,096 bytes", () => {
    for (const n of [10, 40, 70, 150, 400, 2000]) {
      const wire = fitSkills(Array.from({ length: n }, (_, i) => skill(i, "é".repeat(200))));
      expect(jsonbBytes({ ok: true, cardId: "c".repeat(64), ...wire })).toBeLessThan(4_096 - 250);
    }
  });
});

describe("skillCache", () => {
  it("asks once per card for a few minutes, asks again after a failure, and has nothing off a card", async () => {
    const ask = vi.fn<(id: string) => Promise<unknown>>().mockRejectedValueOnce(new Error("off")).mockResolvedValue({ skills: [["a", "", "user"]] });
    const cache = skillCache(ask);
    await expect(cache.get("c1", 0)).rejects.toThrow("off");
    await expect(cache.get("c1", 1)).resolves.toEqual([{ name: "a", description: "", source: "user" }]);
    await cache.get("c1", SKILLS_FRESH_MS);
    expect(ask).toHaveBeenCalledTimes(2);
    await cache.get("c1", SKILLS_FRESH_MS + 1);
    expect(ask).toHaveBeenCalledTimes(3);
    cache.forget();
    await cache.get("c1", SKILLS_FRESH_MS + 2);
    expect(ask).toHaveBeenCalledTimes(4);
    await expect(cache.get(undefined)).resolves.toEqual([]);
  });
});

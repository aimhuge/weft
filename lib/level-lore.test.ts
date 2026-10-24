import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { levelFor } from "./game";
import { loreFor, loreLines, roman } from "./level-lore";

describe("roman", () => {
  it("writes episode numbers", () => {
    expect([1, 4, 9, 14, 24, 40, 49, 99, 2026].map(roman)).toEqual(["I", "IV", "IX", "XIV", "XXIV", "XL", "XLIX", "XCIX", "MMXXVI"]);
  });

  it("never writes an empty episode", () => {
    expect(roman(0)).toBe("I");
    expect(roman(-3)).toBe("I");
  });
});

describe("loreFor", () => {
  it("gives every level the game can reach a picture that ships", () => {
    for (let xp = 0; xp < 200_000; xp += 997) {
      const { level, title } = levelFor(xp);
      const lore = loreFor(level, title);
      expect(existsSync(join(process.cwd(), "public", lore.art))).toBe(true);
      expect(existsSync(join(process.cwd(), "public", lore.voice))).toBe(true);
      expect(lore.line.length).toBeGreaterThan(10);
    }
  });

  it("names the episode and picks the rank's picture", () => {
    expect(loreFor(24, "Loom")).toMatchObject({ episode: "Episode XXIV", art: "/brand/levels/loom.webp" });
    expect(loreFor(1, "Thread").art).toBe("/brand/levels/thread.webp");
  });

  it("reads each line in the clip loreLines names for it", () => {
    expect(loreFor(24, "Loom")).toMatchObject({ voice: "/brand/levels/voice/loom-5.m4a" });
    const clip = loreLines().find((l) => l.line === loreFor(24, "Loom").line)?.clip;
    expect(clip).toBe("loom-5");
    expect(new Set(loreLines().map((l) => l.clip)).size).toBe(loreLines().length);
  });

  it("walks a rank's lines one level at a time", () => {
    const lines = [5, 6, 7, 8, 9].map((l) => loreFor(l, "Strand").line);
    expect(new Set(lines).size).toBe(5);
  });

  it("falls back to the rank the level reaches for a title it doesn't know", () => {
    expect(loreFor(16, "Mystery").art).toBe("/brand/levels/bolt.webp");
    expect(loreFor(0, "Mystery").art).toBe("/brand/levels/thread.webp");
  });
});

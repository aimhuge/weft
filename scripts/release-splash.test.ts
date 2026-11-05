import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copywriterSoul, parseLines, splashPrompt, withSplash } from "./release-splash.mjs";

describe("splashPrompt", () => {
  it("leads with the soul and briefs the version's notes", () => {
    const prompt = splashPrompt("SOUL", "0.7.0", "### Added\n- **A thing.**");
    expect(prompt.startsWith("SOUL\n")).toBe(true);
    expect(prompt).toContain("Weft 0.7.0");
    expect(prompt).toContain("JSON array of strings");
    expect(prompt.endsWith("### Added\n- **A thing.**")).toBe(true);
  });
});

describe("parseLines", () => {
  it("takes the first JSON array, trimmed, at most three lines", () => {
    expect(parseLines('Sure:\n[" One ", "Two", "", 4, "Three", "Four"]\nDone')).toEqual(["One", "Two", "Three"]);
  });

  it("refuses an answer with no array, a non-array or no lines", () => {
    expect(() => parseLines("no json here")).toThrow(/no JSON array/);
    expect(() => parseLines('["", "  "]')).toThrow(/no lines/);
  });
});

describe("withSplash", () => {
  it("puts the version first and replaces an older entry for it", () => {
    const next = withSplash({ "0.6.0": { lines: ["old"] }, "0.7.0": { lines: ["stale"] } }, "0.7.0", ["new"]);
    expect(Object.keys(next)).toEqual(["0.7.0", "0.6.0"]);
    expect(next["0.7.0"]).toEqual({ lines: ["new"] });
  });

  it("keeps a video when one is given", () => {
    expect(withSplash({}, "0.7.0", ["a"], "/whats-new/0.7.0.mp4")).toEqual({ "0.7.0": { lines: ["a"], video: "/whats-new/0.7.0.mp4" } });
  });
});

describe("copywriterSoul", () => {
  it("is the built-in copywriter's soul", () => {
    const agents = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../lib/agents-built-in.json"), "utf8")) as { id: string; soul: string }[];
    expect(copywriterSoul(agents)).toBe(agents.find((a) => a.id === "copywriter")?.soul);
  });

  it("throws when there is none", () => {
    expect(() => copywriterSoul([{ id: "builder", soul: "x" }])).toThrow(/no copywriter/);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES } from "./settings-nav";
import { searchSettings, SETTINGS_SECTIONS, sectionsOf } from "./settings-search";

describe("SETTINGS_SECTIONS", () => {
  it("only names pages that exist", () => {
    const ids = new Set(SETTINGS_PAGES.map((p) => p.id));
    for (const s of SETTINGS_SECTIONS) expect(ids.has(s.page)).toBe(true);
  });

  it("gives each title once, so a jump finds the one section it means", () => {
    const titles = SETTINGS_SECTIONS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // The index is written by hand, so a renamed heading would leave a chip and a search hit that lead nowhere.
  it("names headings the components still draw", () => {
    const dir = join(__dirname, "..", "components");
    const source = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n")
      .replace(/&apos;|&rsquo;/g, "'");
    for (const s of SETTINGS_SECTIONS) expect(source, s.title).toContain(s.title);
  });

  it("lists a page's sections in the order it draws them", () => {
    expect(sectionsOf("threads").map((s) => s.title)).toEqual(["Threads running at once", "Keep conversations open", "Thread instructions"]);
    expect(sectionsOf("team")).toEqual([]);
  });
});

describe("searchSettings", () => {
  it("finds nothing for an empty query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("  !! ")).toEqual([]);
  });

  it("finds a section by its title and names its page", () => {
    expect(searchSettings("trusted")[0]).toEqual({ page: "security", title: "Trusted folders", pageLabel: "Security" });
  });

  it("finds a section by a word it doesn't show", () => {
    expect(searchSettings("dark mode")[0]).toMatchObject({ title: "Appearance" });
    expect(searchSettings("gmail")[0]).toMatchObject({ title: "Google Workspace" });
  });

  it("needs every word to match", () => {
    expect(searchSettings("trusted zebra")).toEqual([]);
  });

  it("finds a page by its own name or hint, sections and all", () => {
    const hits = searchSettings("teams");
    expect(hits[0]).toEqual({ page: "team", title: null, pageLabel: "Teams" });
  });

  it("ranks a title that starts with the query above one that only mentions it", () => {
    const titles = searchSettings("sleep").map((h) => h.title);
    expect(titles.indexOf("Sleep at low battery")).toBeLessThan(titles.indexOf("Only while online"));
  });

  it("scores a word inside a title above one only in the extra words", () => {
    const titles = searchSettings("folders").map((h) => h.title);
    expect(titles.indexOf("Trusted folders")).toBeLessThan(titles.indexOf("Projects"));
  });

  it("matches a word in the middle of a title", () => {
    expect(searchSettings("ackup")[0]).toMatchObject({ title: "Backup model" });
  });

  it("caps the list", () => {
    expect(searchSettings("e", 3)).toHaveLength(3);
  });

  it("matches the /weft:done row by its slash command", () => {
    expect(searchSettings("/weft:done")[0]).toMatchObject({ title: "Run /weft:done on" });
  });
});

import { describe, expect, it } from "vitest";
import { isMarkdownFile, markdownBlocks, markdownSymbolsFor } from "./symbols-markdown";

const DOC = `# Title

Intro words.

## File map

- \`lib/runner.ts\`: runs threads
  and more of it
- \`lib/store.ts\`: storage

| a | b |
|---|---|

## Hotspots

\`\`\`sh
# not a heading

still fenced
\`\`\`

### Deep

Text
`;

describe("markdownBlocks", () => {
  const names = markdownBlocks(DOC).map((b) => b.name);

  it("names blocks by their headings and opening words", () => {
    expect(names).toContain("File map/lib∕runner.ts: runs threads");
    expect(names).toContain("File map/lib∕store.ts: storage");
    expect(names).toContain("Hotspots/Deep/Text");
  });

  it("leaves the h1 out of the path", () => {
    expect(names).toContain("Title");
    expect(names).toContain("Intro words.");
  });

  it("keeps an item's indented lines, and a fence's blank lines, in one block", () => {
    const blocks = markdownBlocks(DOC);
    const item = blocks.find((b) => b.name.includes("runner"));
    expect((item?.to ?? 0) - (item?.from ?? 0)).toBe(1);
    expect(names.filter((n) => n.startsWith("Hotspots/")).length).toBe(3);
    expect(names).not.toContain("not a heading");
  });

  it("numbers a repeated name", () => {
    expect(markdownBlocks("- same\n- same\n- same").map((b) => b.name)).toEqual(["same", "same#2", "same#3"]);
  });
});

describe("markdownSymbolsFor", () => {
  it("claims the block an edit changes", () => {
    expect(markdownSymbolsFor(DOC, "runs threads", "runs them", false)).toEqual(["File map/lib∕runner.ts: runs threads", "File map/lib∕runner.ts: runs them"]);
  });

  it("claims a bullet the edit inserts as well as its neighbour", () => {
    const old = "- `lib/store.ts`: storage";
    expect(markdownSymbolsFor(DOC, old, `${old}\n- \`lib/new.ts\`: new`)).toEqual(["File map/lib∕store.ts: storage", "File map/lib∕new.ts: new"]);
  });

  it("claims every place with replace_all", () => {
    expect(markdownSymbolsFor("- a x\n\n- b x", "x", "y", true)).toHaveLength(4);
  });

  it("is null for the whole file when it can't place the edit", () => {
    expect(markdownSymbolsFor(DOC, "", "x")).toBeNull();
    expect(markdownSymbolsFor(DOC, "not there", "x")).toBeNull();
    expect(markdownSymbolsFor("a\n\n\nb", "\n\n", "\n\n\n")).toBeNull();
  });

  it("knows Markdown files", () => {
    expect(["a.md", "b.MDX", "c.markdown"].every(isMarkdownFile)).toBe(true);
    expect(isMarkdownFile("a.ts")).toBe(false);
  });
});

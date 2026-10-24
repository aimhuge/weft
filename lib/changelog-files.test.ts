import { describe, expect, it } from "vitest";
import { carries, cleanFiles, filesInText, filesOf } from "./changelog-files";

// Which files a changelog entry is about, and whether a commit carries it (lib/changelog-files.ts).

describe("changelog files", () => {
  it("cleans a file list", () => {
    expect(cleanFiles(undefined)).toEqual([]);
    expect(cleanFiles(["./lib/a.ts", "lib/a.ts", "docs/", "  ", " app/x.tsx "])).toEqual(["lib/a.ts", "docs", "app/x.tsx"]);
  });

  it("reads the paths out of an entry's text, not commands, versions, urls or env names", () => {
    const text =
      "**Preview.** Files: `lib/app-preview.ts`, `components/Pane.tsx`, `docs/`, `CHANGELOG.md`; run `pnpm test`, " +
      "`process.env`, `1.2.0`, `/api/cards`, `~/.weft/x.json`, `https://a.b/c.md`, `/`, `aimhuge/weft`.";
    expect(filesInText(text)).toEqual(["lib/app-preview.ts", "components/Pane.tsx", "docs", "CHANGELOG.md"]);
  });

  it("prefers the entry's own files to its text", () => {
    expect(filesOf({ files: ["a.ts"], text: "`b.ts`" })).toEqual(["a.ts"]);
    expect(filesOf({ files: [], text: "`b.ts`" })).toEqual(["b.ts"]);
    expect(filesOf({ text: "none here" })).toEqual([]);
  });

  it("carries an entry when the commit touched one of its files, a file in its folder, or its path from a subfolder", () => {
    const entry = { files: ["lib/a.ts", "docs", "Pane.tsx"], text: "" };
    expect(carries(entry, ["lib/a.ts"])).toBe(true);
    expect(carries(entry, ["docs/x.md"])).toBe(true);
    expect(carries(entry, ["components/Pane.tsx"])).toBe(true);
    expect(carries(entry, ["lib/ab.ts", "docsy/x.md", "other.ts"])).toBe(false);
    expect(carries(entry, [])).toBe(false);
  });

  it("carries an entry with no files on any commit, as before", () => {
    expect(carries({ text: "no paths" }, [])).toBe(true);
    expect(carries({ text: "no paths" }, ["x.ts"])).toBe(true);
  });
});

// SOUL.md rides into every thread (CLAUDE.md includes it), so it stays small: it grew from 5 KB to 73 KB in two
// weeks when every /weft:done appended to its file map. The map now lives in docs/architecture/MAP.md, read on
// demand. Lower SOUL_MAX_BYTES when the file shrinks; never raise it to fit a feature's details.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const SOUL_MAX_BYTES = 12_000;
const DOCS = path.join(ROOT, "docs/architecture");

describe("SOUL.md", () => {
  it("stays under its byte cap", () => {
    expect(fs.statSync(path.join(ROOT, "SOUL.md")).size).toBeLessThanOrEqual(SOUL_MAX_BYTES);
  });

  it("points at the file map", () => {
    expect(fs.readFileSync(path.join(ROOT, "SOUL.md"), "utf8")).toContain("docs/architecture/MAP.md");
  });
});

describe("docs/architecture/MAP.md", () => {
  it("lists every doc in its folder", () => {
    const map = fs.readFileSync(path.join(DOCS, "MAP.md"), "utf8");
    const docs = fs.readdirSync(DOCS).filter((f) => f.endsWith(".md") && f !== "MAP.md");
    expect(docs.filter((f) => !map.includes(`\`${f}\``))).toEqual([]);
  });
});

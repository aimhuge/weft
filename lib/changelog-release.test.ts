import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-release-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "weft-changelog-release-repo-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));

const { addEntry, changelogFile, entriesFor, stampCard } = await import("./changelog");
const { releaseToFile } = await import("./changelog-release");

const file = path.join(repo, "CHANGELOG.md");
beforeEach(() => {
  fs.rmSync(changelogFile(), { force: true });
  fs.rmSync(file, { force: true });
});

describe("releaseToFile", () => {
  it("writes the version's section and marks the entries released, counting drafts", () => {
    addEntry({ project: repo, kind: "added", text: "A", cardId: "c1" });
    addEntry({ project: repo, kind: "fixed", text: "B", cardId: "c2" });
    stampCard("c1", repo, "abc1234");
    expect(releaseToFile(repo, "1.0.0", "2026-10-23")).toEqual({ file, version: "1.0.0", entries: 2, drafts: 1 });
    expect(fs.readFileSync(file, "utf8")).toContain("## [Unreleased]\n\n## [1.0.0] - 2026-10-23\n\n### Added\n\n- A\n\n### Fixed\n\n- B\n");
    expect(entriesFor(repo).every((e) => e.version === "1.0.0")).toBe(true);
  });

  it("refuses a bad or repeated version and marks nothing when the file can't be written", () => {
    expect(() => releaseToFile(repo, "next")).toThrow(/isn't a version/);
    releaseToFile(repo, "1.0.0", "d");
    expect(() => releaseToFile(repo, "v1.0.0")).toThrow("CHANGELOG.md already has 1.0.0.");
    addEntry({ project: path.join(repo, "missing"), kind: "added", text: "x" });
    expect(() => releaseToFile(path.join(repo, "missing"), "2.0.0")).toThrow();
    expect(entriesFor(path.join(repo, "missing"))[0]?.version).toBeUndefined();
  });

  it("dates today by default", () => {
    releaseToFile(repo, "1.0.0-beta.1");
    expect(fs.readFileSync(file, "utf8")).toContain(`## [1.0.0-beta.1] - ${new Date().toISOString().slice(0, 10)}`);
  });
});

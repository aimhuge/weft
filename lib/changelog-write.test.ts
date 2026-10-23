import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The background CHANGELOG.md write (lib/changelog-write.ts) against a real temp repo, the store in a temp dir.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cl-write-"));
vi.mock("./store", () => ({ DATA_DIR: dir }));

const { addEntry, changelogFile, entriesFor, stampCard } = await import("./changelog");
const { bumpedVersion, writeChangelog, writeNote } = await import("./changelog-write");

let repo = "";
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const commit = (name: string, body = name) => {
  fs.writeFileSync(path.join(repo, name), body);
  git("add", name);
  git("commit", "-qm", `add ${name}`);
};
const changelog = () => fs.readFileSync(path.join(repo, "CHANGELOG.md"), "utf8");
const shipped = (text: string, kind: "added" | "fixed" = "added") => {
  addEntry({ project: repo, kind, text, cardId: "c1" });
  stampCard("c1", repo, git("rev-parse", "HEAD"));
};

beforeEach(() => {
  fs.rmSync(changelogFile(), { force: true });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-cl-repo-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.hooksPath", ".no-hooks");
  commit("a");
});

describe("writeChangelog", () => {
  it("never starts a CHANGELOG.md for a project with no entries", async () => {
    expect(await writeChangelog(repo, "x")).toEqual({});
    expect(fs.existsSync(path.join(repo, "CHANGELOG.md"))).toBe(false);
  });

  it("writes committed entries under Unreleased and commits the file alone; drafts wait", async () => {
    shipped("**Login.** Works.");
    addEntry({ project: repo, kind: "fixed", text: "Still a draft", cardId: "c2" });
    fs.writeFileSync(path.join(repo, "other.ts"), "dirty");
    const r = await writeChangelog(repo, "Login card");
    expect(r).toEqual({ commit: git("rev-parse", "--short", "HEAD") });
    expect(git("log", "-1", "--format=%s")).toBe("docs(changelog): Login card");
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe("CHANGELOG.md");
    expect(changelog()).toContain("## [Unreleased]\n\n### Added\n\n- **Login.** Works.\n");
    expect(changelog()).not.toContain("Still a draft");
    expect(git("status", "--porcelain")).toBe("?? other.ts");
    expect(writeNote(r)).toBe(`Weft committed CHANGELOG.md as ${r.commit}.`);
    expect(await writeChangelog(repo, "again")).toEqual({});
  });

  it("keeps lines typed by hand and doesn't repeat its own", async () => {
    commit("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Typed by hand.\n");
    shipped("First");
    await writeChangelog(repo, "one");
    shipped("Second", "fixed");
    await writeChangelog(repo, "two");
    expect(changelog()).toContain("### Added\n\n- First\n\n### Fixed\n\n- Typed by hand.\n- Second\n");
    expect(changelog().match(/- First/g)).toHaveLength(1);
  });

  it("moves Unreleased under the version a commit bumped package.json to, once", async () => {
    commit("package.json", '{"version":"0.1.0"}');
    shipped("Feature");
    await writeChangelog(repo, "feature");
    commit("package.json", '{"version":"0.2.0"}');
    const r = await writeChangelog(repo, "bump", "2026-10-23");
    expect(r).toEqual({ commit: git("rev-parse", "--short", "HEAD"), released: "0.2.0" });
    expect(git("log", "-1", "--format=%s")).toBe("docs(changelog): 0.2.0");
    expect(changelog()).toContain("## [Unreleased]\n\n## [0.2.0] - 2026-10-23\n\n### Added\n\n- Feature\n");
    expect(entriesFor(repo)[0]?.version).toBe("0.2.0");
    expect(writeNote(r)).toMatch(/0\.2\.0's notes .* tag after this/);
    shipped("Next");
    await writeChangelog(repo, "next");
    expect(changelog()).toContain("## [Unreleased]\n\n### Added\n\n- Next\n\n## [0.2.0]");
    expect(entriesFor(repo)[1]?.version).toBeUndefined();
  });

  it("doesn't release a version the file already has", async () => {
    commit("package.json", '{"version":"0.1.0"}');
    commit("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - d\n");
    commit("package.json", '{"version":"0.2.0"}');
    shipped("Feature");
    expect((await writeChangelog(repo, "x")).released).toBeUndefined();
    expect(changelog()).toContain("## [Unreleased]\n\n### Added\n\n- Feature\n\n## [0.2.0] - d");
  });

  it("reports a refused commit and commits the file after the next one", async () => {
    fs.mkdirSync(path.join(repo, ".no-hooks"));
    fs.writeFileSync(path.join(repo, ".no-hooks", "pre-commit"), "#!/bin/sh\necho no >&2\nexit 1\n", { mode: 0o755 });
    shipped("Feature");
    const r = await writeChangelog(repo, "x");
    expect(r.error).toMatch(/no/);
    expect(writeNote(r)).toMatch(/couldn't commit CHANGELOG.md/);
    expect(changelog()).toContain("- Feature");
    fs.rmSync(path.join(repo, ".no-hooks"), { recursive: true });
    expect((await writeChangelog(repo, "y")).commit).toBe(git("rev-parse", "--short", "HEAD"));
  });

  it("waits out another commit's index lock, and gives up on one that stays", async () => {
    shipped("Feature");
    const lock = path.join(repo, ".git", "index.lock");
    fs.writeFileSync(lock, "");
    setTimeout(() => fs.rmSync(lock, { force: true }), 300);
    expect((await writeChangelog(repo, "x")).commit).toBeTruthy();
    shipped("More");
    fs.writeFileSync(lock, "");
    expect((await writeChangelog(repo, "y")).error).toMatch(/index\.lock/);
    fs.rmSync(lock);
  });

  it("turns a failure outside git's commit into an error result", async () => {
    addEntry({ project: "/nowhere/at/all", kind: "added", text: "x", cardId: "c1" });
    stampCard("c1", "/nowhere/at/all", "abc1234");
    expect((await writeChangelog("/nowhere/at/all", "x")).error).toBeTruthy();
    expect(writeNote({})).toBe("");
  });
});

describe("bumpedVersion", () => {
  it("is null without package.json, on a first commit, and when it didn't change", async () => {
    expect(await bumpedVersion(repo)).toBeNull();
    commit("package.json", '{"version":"1.0.0"}');
    commit("b");
    expect(await bumpedVersion(repo)).toBeNull();
    commit("package.json", '{"name":"x"}');
    expect(await bumpedVersion(repo)).toBeNull();
  });
});

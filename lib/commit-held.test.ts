import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimKey } from "./claims";
import { applyHunks, heldNote, holdBack, ownHunks, parseHunks } from "./commit-held";
import type { Card } from "./types";

const SCRIPT = path.resolve("plugin/skills/done/commit.sh");
const BASE = "# Doc\n\n## Map\n\n- a\n- b\n- c\n";
const card = (id: string, cwd: string, claims: string[]) => ({ id, cwd, claims, column: "running", title: id }) as unknown as Card;

vi.mock("./overlap", async (original) => ({
  ...(await original<typeof import("./overlap")>()),
  busyInFolder: (cards: Card[], _cwd: string, except: string) => cards.filter((c) => c.id !== except && c.column === "running"),
}));

let root: string;
let file: string;
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const commit = (...paths: string[]) => execFileSync("bash", [SCRIPT, "doc: mine", ...paths], { cwd: root, encoding: "utf8" });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "held-")));
  file = path.join(root, "doc.md");
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  fs.writeFileSync(file, BASE);
  git("add", ".");
  git("commit", "-qm", "base");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// Mine is a line after `a`, theirs a line after `c`.
function shareTheFile() {
  fs.writeFileSync(file, "# Doc\n\n## Map\n\n- a\n- mine\n- b\n- c\n- theirs\n");
  const key = (n: string) => claimKey(file, `Map/${n}`);
  return { me: card("me", root, [key("mine")]), them: card("them", root, [key("theirs")]) };
}

describe("hunks", () => {
  it("reads hunk headers, with their default counts", () => {
    expect(parseHunks("@@ -1 +1,2 @@ x\n@@ -5,0 +7 @@")).toEqual([
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2 },
      { oldStart: 5, oldLines: 0, newStart: 7, newLines: 1 },
    ]);
  });

  it("applies only the chosen hunks", () => {
    const work = "x\nb\nc\nnew";
    const hunks = parseHunks("@@ -1 +1 @@\n@@ -3,0 +4 @@");
    expect(applyHunks("a\nb\nc", work, hunks)).toBe(work);
    expect(applyHunks("a\nb\nc", work, [hunks[0]!])).toBe("x\nb\nc");
    expect(applyHunks("a\nb\nc", work, [hunks[1]!])).toBe("a\nb\nc\nnew");
  });

  it("keeps a hunk both cards touched", () => {
    const f = "/x.md";
    const hunks = parseHunks("@@ -1 +1 @@");
    const key = claimKey(f, "both");
    expect(ownHunks("- both", hunks, f, [key], [key])).toHaveLength(1);
    expect(ownHunks("- both", hunks, f, [], [key])).toHaveLength(0);
  });
});

describe("commit.sh with a held note", () => {
  it("commits my line and leaves theirs in the working tree", async () => {
    const { me, them } = shareTheFile();
    expect(await holdBack(root, ["doc.md"], me, [me, them])).toEqual(["doc.md"]);
    commit("doc.md");
    expect(git("show", "HEAD:doc.md")).toBe("# Doc\n\n## Map\n\n- a\n- mine\n- b\n- c\n");
    expect(fs.readFileSync(file, "utf8")).toContain("- theirs");
    expect(git("diff", "HEAD", "--stat")).toContain("doc.md");
    expect(git("diff", "--cached", "--stat")).toBe("");
  });

  it("commits the other paths whole beside it", async () => {
    const { me, them } = shareTheFile();
    fs.writeFileSync(path.join(root, "other.txt"), "new");
    await holdBack(root, ["doc.md"], me, [me, them]);
    commit("doc.md", "other.txt");
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe("doc.md\nother.txt\n");
  });

  it("ignores a note once the file has moved on, and commits it whole", async () => {
    const { me, them } = shareTheFile();
    await holdBack(root, ["doc.md"], me, [me, them]);
    fs.appendFileSync(file, "- later\n");
    commit("doc.md");
    expect(git("show", "HEAD:doc.md")).toContain("- theirs");
  });

  it("ignores a note once HEAD has moved on, so it can't revert that commit", async () => {
    const { me, them } = shareTheFile();
    await holdBack(root, ["doc.md"], me, [me, them]);
    fs.writeFileSync(path.join(root, "z.txt"), "z");
    git("add", "z.txt");
    git("commit", "-qm", "moved");
    commit("doc.md");
    expect(git("show", "HEAD:doc.md")).toContain("- theirs");
    expect(git("show", "HEAD:z.txt")).toBe("z");
  });
});

describe("holdBack", () => {
  it("holds nothing when no other busy card has blocks there", async () => {
    const { me, them } = shareTheFile();
    expect(await holdBack(root, ["doc.md"], me, [me, { ...them, column: "review" }])).toEqual([]);
    expect(await holdBack(root, ["doc.md"], me, [me, card("them", root, [claimKey(file)])])).toEqual([]);
  });

  it("skips files that aren't Markdown, and clears a stale note", async () => {
    const { me, them } = shareTheFile();
    expect(await holdBack(root, ["a.ts"], me, [me, them])).toEqual([]);
    await holdBack(root, ["doc.md"], me, [me, them]);
    const note = path.join(root, ".git/weft-held", heldNote("doc.md"));
    expect(fs.existsSync(note)).toBe(true);
    await holdBack(root, ["doc.md"], me, [me]);
    expect(fs.existsSync(note)).toBe(false);
  });

  it("keeps going when git can't answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gone = card("me", "/nowhere", []);
    expect(await holdBack("/nowhere", ["doc.md"], gone, [gone])).toEqual([]);
  });

  it("names a note the way commit.sh does", () => {
    const sha = execFileSync("git", ["hash-object", "--stdin"], { input: "docs/a.md", encoding: "utf8" }).trim();
    expect(heldNote("docs/a.md")).toBe(sha);
  });
});

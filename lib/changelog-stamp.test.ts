import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The changelog's commit stamp (lib/changelog-stamp.ts) against a real temp repo, the store in a temp dir.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-stamp-"));
const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-stamp-repo-")));
const cards: Record<string, { id: string; title?: string; cwd: string }> = {
  c1: { id: "c1", title: "Card one", cwd: repo },
  c2: { id: "c2", title: "Card two", cwd: repo },
};
vi.mock("./store", () => ({ DATA_DIR: dir, getCard: (id: string) => cards[id] }));

const { addEntry, changelogFile, readChangelog } = await import("./changelog");
const { changelogStampHooks, head, stampAfterCommit, stampNote } = await import("./changelog-stamp");

const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
const commit = (name: string, message = name) => {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), name);
  git("add", name);
  git("commit", "-qm", message);
};

type Hook = (input: Record<string, unknown>, id: string | undefined, opts: unknown) => Promise<Record<string, unknown>>;
const hooks = (cardId: string | undefined = "c1") => {
  const h = changelogStampHooks(() => cardId);
  return { pre: h.pre.hooks[0] as unknown as Hook, post: h.post.hooks[0] as unknown as Hook };
};
const bash = (event: string, command: string) => ({ hook_event_name: event, tool_name: "Bash", tool_input: { command }, cwd: repo });

beforeEach(() => fs.rmSync(changelogFile(), { force: true }));

describe("changelog stamp", () => {
  it("reads HEAD, or null outside a repo or before the first commit", () => {
    expect(head(os.tmpdir())).toBeNull();
    commit("a");
    expect(head(repo)).toBe(git("rev-parse", "HEAD"));
  });

  it("stamps the card's drafts when its own Bash commit moves HEAD, and tells the thread", async () => {
    const e = addEntry({ project: repo, kind: "added", text: "x", cardId: "c1" });
    const { pre, post } = hooks();
    expect(await pre(bash("PreToolUse", "git commit -m feat"), "t1", {})).toEqual({});
    commit("b");
    const sha = git("rev-parse", "HEAD");
    const out = await post(bash("PostToolUse", "git commit -m feat"), "t1", {});
    expect(readChangelog().find((x) => x.id === e.id)?.sha).toBe(sha);
    expect(JSON.stringify(out)).toContain(`"hookEventName":"PostToolUse","additionalContext":"Weft stamped 1 changelog entry of this card with ${sha.slice(0, 7)}`);
    // Then Weft committed CHANGELOG.md right after the card's commit, and said so.
    expect(git("log", "-1", "--format=%s")).toBe("docs(changelog): Card one");
    expect(git("rev-parse", "HEAD~1")).toBe(sha);
    expect(JSON.stringify(out)).toContain(`Weft committed CHANGELOG.md as ${git("rev-parse", "--short", "HEAD")}.`);
  });

  it("says entries, plural, and stamps commit.sh runs too", async () => {
    addEntry({ project: repo, kind: "added", text: "x", cardId: "c1" });
    addEntry({ project: repo, kind: "fixed", text: "y", cardId: "c1" });
    const { pre, post } = hooks();
    await pre(bash("PreToolUse", "bash commit.sh 'msg' a b"), "t2", {});
    commit("c");
    const out = await post(bash("PostToolUse", "bash commit.sh 'msg' a b"), "t2", {});
    expect(JSON.stringify(out)).toContain("2 changelog entries");
  });

  it("stamps nothing when HEAD didn't move, the call wasn't a commit, it failed, or there are no drafts", async () => {
    const e = addEntry({ project: repo, kind: "added", text: "x", cardId: "c1" });
    const { pre, post } = hooks();
    await pre(bash("PreToolUse", "git commit -m nope"), "t3", {});
    expect(await post(bash("PostToolUse", "git commit -m nope"), "t3", {})).toEqual({});
    await pre(bash("PreToolUse", "ls"), "t4", {});
    commit("d");
    expect(await post(bash("PostToolUse", "ls"), "t4", {})).toEqual({});
    await pre(bash("PreToolUse", "git commit -m x"), "t5", {});
    commit("e");
    expect(await post(bash("PostToolUseFailure", "git commit -m x"), "t5", {})).toEqual({});
    expect(readChangelog().find((x) => x.id === e.id)?.sha).toBeUndefined();
    const other = hooks("c3");
    expect(await other.pre(bash("PreToolUse", "git commit"), "t6", {})).toEqual({});
    expect(await other.post(bash("PostToolUse", "git commit"), "t6", {})).toEqual({});
    expect(await post(bash("PostToolUse", "git commit"), undefined, {})).toEqual({});
    expect(await pre(bash("PostToolUse", "git commit"), "t7", {})).toEqual({});
  });

  it("returns 0 when nothing of that card is waiting, and forgets the oldest of too many pending calls", async () => {
    commit("f");
    const { pre, post } = hooks();
    await pre(bash("PreToolUse", "git commit"), "t8", {});
    commit("g");
    expect(await post(bash("PostToolUse", "git commit"), "t8", {})).toEqual({});
    expect(stampAfterCommit(undefined, repo, "abc")).toBe(0);
    expect(stampAfterCommit("c1", repo, null)).toBe(0);
    for (let i = 0; i < 105; i++) await pre(bash("PreToolUse", "git commit"), `many-${i}`, {});
  }, 30_000);

  describe("in a shared tree", () => {
    const sha = () => git("rev-parse", "HEAD");
    const shaOf = (id: string) => readChangelog().find((x) => x.id === id)?.sha;

    it("leaves a card's draft alone when another card's commit lands from its thread, and stamps it on its own", async () => {
      const preview = addEntry({ project: repo, kind: "added", text: "**Preview.** Files: `lib/preview.ts`.", cardId: "c1" });
      const { pre, post } = hooks();
      await pre(bash("PreToolUse", "git commit -m quota"), "s1", {});
      commit("lib/quota.ts");
      const quota = sha();
      const out = JSON.stringify(await post(bash("PostToolUse", "git commit -m quota"), "s1", {}));
      expect(shaOf(preview.id)).toBeUndefined();
      expect(out).toContain(`1 draft entry of this card stayed draft: the commit touched none of its files (${preview.id})`);
      expect(out).toContain(`sha ${quota.slice(0, 7)}`);
      await pre(bash("PreToolUse", "git commit -m preview"), "s2", {});
      commit("lib/preview.ts");
      const own = sha();
      const done = JSON.stringify(await post(bash("PostToolUse", "git commit -m preview"), "s2", {}));
      expect(shaOf(preview.id)).toBe(own);
      expect(done).toContain(`Weft stamped 1 changelog entry of this card with ${own.slice(0, 7)}`);
      expect(done).not.toContain("stayed draft");
    });

    it("stamps each card's entry in a batch commit only when it touched that entry's files", () => {
      const a = addEntry({ project: repo, kind: "added", text: "a", files: ["app/a"], cardId: "c1" });
      const b = addEntry({ project: repo, kind: "fixed", text: "b", files: ["lib/b.ts"], cardId: "c2" });
      commit("app/a/page.tsx");
      expect(stampAfterCommit("c1", repo, sha())).toBe(1);
      expect(stampAfterCommit("c2", repo, sha())).toBe(0);
      expect(shaOf(a.id)).toBe(sha());
      expect(shaOf(b.id)).toBeUndefined();
    });

    it("stamps each entry with the commit that carried it when one call lands several, and says so", async () => {
      const x = addEntry({ project: repo, kind: "added", text: "x", files: ["x.ts"], cardId: "c1" });
      const y = addEntry({ project: repo, kind: "added", text: "y", files: ["y.ts", "y2.ts"], cardId: "c1" });
      const { pre, post } = hooks();
      await pre(bash("PreToolUse", "git commit -m x && git commit -m y"), "s3", {});
      commit("x.ts");
      const first = sha();
      commit("y.ts");
      const second = sha();
      const out = JSON.stringify(await post(bash("PostToolUse", "git commit"), "s3", {}));
      expect(shaOf(x.id)).toBe(first);
      expect(shaOf(y.id)).toBe(second);
      expect(out).toContain(`2 changelog entries of this card with ${first.slice(0, 7)}, ${second.slice(0, 7)}`);
    });

    it("says entries, plural, of drafts left behind", async () => {
      addEntry({ project: repo, kind: "added", text: "p", files: ["p.ts"], cardId: "c1" });
      addEntry({ project: repo, kind: "added", text: "q", files: ["q.ts"], cardId: "c1" });
      const { pre, post } = hooks();
      await pre(bash("PreToolUse", "git commit"), "s4", {});
      commit("other.ts");
      expect(JSON.stringify(await post(bash("PostToolUse", "git commit"), "s4", {}))).toContain("2 draft entries of this card stayed draft: the commit touched none of their files");
    });
  });

  describe("a feat or fix with no entry", () => {
    const land = async (cardId: string, file: string, message: string, id: string) => {
      const { pre, post } = hooks(cardId);
      await pre(bash("PreToolUse", "git commit"), id, {});
      commit(file, message);
      const sha = git("rev-parse", "--short", "HEAD");
      return { out: JSON.stringify(await post(bash("PostToolUse", "git commit"), id, {})), sha };
    };

    it("reminds the card to record one, naming the commit to stamp it on", async () => {
      const { out, sha } = await land("c1", "f1.ts", "feat(board): a thing", "r1");
      expect(out).toContain(`This call committed a feat or fix (${sha}), and this card has no changelog entry for this project yet.`);
      expect(out).toContain(`mcp__board__changelog_edit with its id and sha ${sha}`);
      expect((await land("c1", "f2.ts", "fix!: a breaking fix", "r2")).out).toContain("committed a feat or fix");
    });

    it("stays quiet for other commit types, a card that has an entry there already, and no card", async () => {
      expect((await land("c1", "f3.ts", "docs: words", "r3")).out).not.toContain("feat or fix");
      expect((await land("c1", "f4.ts", "feature: not conventional", "r4")).out).not.toContain("feat or fix");
      addEntry({ project: repo, kind: "added", text: "recorded before", cardId: "c2" });
      expect((await land("c2", "f5.ts", "fix: follow-up", "r5")).out).not.toContain("feat or fix");
      const was = git("rev-parse", "HEAD");
      commit("f6.ts", "feat: no card");
      expect(stampNote(undefined, repo, was, git("rev-parse", "HEAD"))).toBe("");
    });
  });
});

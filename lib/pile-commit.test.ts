import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const busy = new Set<string>();

vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = { ...cards.get(id)!, ...patch };
    cards.set(id, card);
    return card;
  }),
  appendThread: vi.fn(() => 0),
}));
vi.mock("./runner", () => ({
  isBusy: (id: string) => busy.has(id),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  sendUserMessage: vi.fn(),
}));

const store = await import("./store");
const runner = await import("./runner");
const { commitFromPage, failureMessage, moveToDone, parseCommitRequest, recentCommit, safePath } = await import("./pile-commit");

const SCRIPT = path.resolve(__dirname, "../plugin/skills/done/commit.sh");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pile-commit-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

let n = 0;
// A repo with one commit, a bare remote it pushes to, and two uncommitted files.
function repo() {
  const root = path.join(tmp, `repo${++n}`);
  const remote = path.join(tmp, `remote${n}.git`);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  fs.mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "T");
  fs.writeFileSync(path.join(root, "a.ts"), "a\n");
  git(root, "add", "a.ts");
  git(root, "commit", "-q", "-m", "init");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "-u", "origin", "main");
  fs.writeFileSync(path.join(root, "a.ts"), "a2\n");
  fs.writeFileSync(path.join(root, "b.ts"), "b\n");
  return { root, remote };
}

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: "/", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over };
}

beforeEach(() => {
  cards.clear();
  busy.clear();
  vi.clearAllMocks();
});

describe("safePath / parseCommitRequest", () => {
  it("takes plain relative paths only", () => {
    expect(safePath("lib/a.ts")).toBe(true);
    expect(safePath("dir with space/x.ts")).toBe(true);
    for (const bad of ["", ".", "/etc/passwd", "../x", "a/../../x", "-A", ":(glob)*", "a\0b"]) expect(safePath(bad)).toBe(false);
  });

  it("reads a body or link, deduping paths and taking push as a flag", () => {
    expect(parseCommitRequest({ message: " feat: x ", paths: ["a.ts", "a.ts", "b.ts"], push: "1", done: "c1", change: "3", label: "X" })).toEqual({
      message: "feat: x",
      paths: ["a.ts", "b.ts"],
      push: true,
      done: "c1",
      change: "3",
      label: "X",
    });
    expect(parseCommitRequest({ message: "m", paths: ["a"], push: null })).toEqual({ message: "m", paths: ["a"], push: false, done: undefined, change: undefined, label: undefined });
  });

  it("refuses a missing message, no paths, or a path it can't take", () => {
    expect(() => parseCommitRequest({ paths: ["a"] })).toThrow("needs a message");
    expect(() => parseCommitRequest({ message: "m", paths: [] })).toThrow("at least one path");
    expect(() => parseCommitRequest({ message: "m" })).toThrow("at least one path");
    expect(() => parseCommitRequest({ message: "m", paths: ["."] })).toThrow("can take: .");
    expect(() => parseCommitRequest({ message: "m", paths: [3] })).toThrow("can take: (empty)");
  });
});

describe("moveToDone", () => {
  it("moves the card, queues Done's automations and files it away", () => {
    cards.set("c", card("c"));
    moveToDone("c");
    expect(cards.get("c")?.column).toBe("done");
    expect(runner.queueMessages).toHaveBeenCalledWith("c", []);
    expect(runner.archiveWhenIdle).toHaveBeenCalledWith("c");
  });

  it("leaves a card already in Done alone and refuses what the board refuses", () => {
    cards.set("d", card("d", { column: "done" }));
    moveToDone("d");
    expect(store.updateCard).not.toHaveBeenCalled();
    expect(() => moveToDone("nope")).toThrow("No such card");
    cards.set("cp", card("cp", { role: "copilot" }));
    expect(() => moveToDone("cp")).toThrow("copilot");
  });

  it("lets a busy card's Done move wait for its turn to end", () => {
    cards.set("b", card("b", { column: "running" }));
    busy.add("b");
    moveToDone("b");
    expect(cards.get("b")?.column).toBe("running");
    expect(runner.queueMessages).toHaveBeenCalledWith("b", []);
    expect(runner.archiveWhenIdle).toHaveBeenCalledWith("b");
  });
});

describe("commitFromPage", () => {
  it("commits only the given paths, pushes, moves the card to Done and notes it in the thread", async () => {
    const { root, remote } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    cards.set("c1", card("c1"));
    const real = fs.realpathSync(root);
    cards.set("c2", card("c2", { claims: [`${real}/a.ts#a`, `${real}/b.ts#b`] }));
    const result = await commitFromPage("pile", { message: "feat: a", paths: ["a.ts"], push: true, done: "c1", change: "1", label: "A" }, SCRIPT);
    expect(result).toEqual({ ok: true, change: "1", hash: git(root, "rev-parse", "--short", "HEAD"), pushed: true, done: true });
    expect(git(root, "log", "-1", "--format=%s")).toBe("feat: a");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("a.ts");
    // b.ts is still uncommitted, and the remote has the commit.
    expect(git(root, "status", "--porcelain")).toBe("?? b.ts");
    expect(git(remote, "rev-parse", "--short", "main")).toBe(result.hash);
    expect(cards.get("c1")?.column).toBe("done");
    // The committed file's claims drop; the uncommitted one's stay.
    expect(cards.get("c2")?.claims).toEqual([`${real}/b.ts#b`]);
    expect(store.appendThread).toHaveBeenCalledWith("pile", expect.objectContaining({ kind: "tool", name: "Commit", isError: false, summary: `${result.hash} feat: a (1 file) · pushed · card moved to Done` }));
    expect(runner.sendUserMessage).not.toHaveBeenCalled();
  });

  it("refuses a path that isn't uncommitted, without committing anything", async () => {
    const { root } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    const before = git(root, "rev-parse", "HEAD");
    const result = await commitFromPage("pile", { message: "m", paths: ["a.ts", "nope.ts"], push: false }, SCRIPT);
    expect(result).toMatchObject({ ok: false, failed: "commit", error: "Nothing uncommitted at nope.ts." });
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(store.appendThread).toHaveBeenCalledWith("pile", expect.objectContaining({ isError: true, summary: "m (2 files) · commit failed" }));
    expect(runner.sendUserMessage).toHaveBeenCalledWith("pile", expect.stringContaining("couldn't be committed"));
  });

  it("takes paths its card's own Done just committed as already committed, then pushes and moves the card", async () => {
    const { root, remote } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    cards.set("c1", card("c1"));
    git(root, "add", "a.ts", "b.ts");
    git(root, "commit", "-q", "-m", "feat: by the card");
    const hash = git(root, "rev-parse", "--short", "HEAD");
    const result = await commitFromPage("pile", { message: "feat: ab", paths: ["a.ts", "b.ts"], push: true, done: "c1", change: "4" }, SCRIPT);
    expect(result).toEqual({ ok: true, change: "4", hash, already: true, pushed: true, done: true });
    expect(git(root, "rev-parse", "--short", "HEAD")).toBe(hash);
    expect(git(remote, "rev-parse", "--short", "main")).toBe(hash);
    expect(store.appendThread).toHaveBeenCalledWith(
      "pile",
      expect.objectContaining({ isError: false, summary: `${hash} feat: ab (2 files) · already committed · pushed · card moved to Done`, result: `already in ${hash}` }),
    );
    expect(runner.sendUserMessage).not.toHaveBeenCalled();
  });

  it("commits the rest when a recent commit already took some of the paths", async () => {
    const { root } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    git(root, "commit", "-q", "-am", "feat: a by the card");
    const result = await commitFromPage("pile", { message: "feat: b", paths: ["a.ts", "b.ts"], push: false }, SCRIPT);
    expect(result).toMatchObject({ ok: true, hash: git(root, "rev-parse", "--short", "HEAD") });
    expect(result.already).toBeUndefined();
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("b.ts");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("counts only commits inside the window, so a path never changed (or changed long ago) still fails", async () => {
    const { root } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    git(root, "checkout", "-q", "a.ts");
    const result = await commitFromPage("pile", { message: "m", paths: ["a.ts"], push: false }, SCRIPT);
    expect(result.ok).toBe(true);
    expect(result.already).toBe(true);
    // The same path with a window that ends before its commit: never changed as far as the page knows.
    expect(await recentCommit(root, ["a.ts", "nope.ts"], Date.now() + 60_000)).toEqual({ hash: undefined, missing: ["a.ts", "nope.ts"] });
    const old = await recentCommit(root, ["a.ts", "nope.ts"]);
    expect(old).toEqual({ hash: git(root, "rev-parse", "--short", "HEAD"), missing: ["nope.ts"] });
  });

  it("hands a refused commit to the thread with git's words", async () => {
    const { root } = repo();
    fs.mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'types broke in b.ts' >&2\nexit 1\n", { mode: 0o755 });
    cards.set("pile", card("pile", { cwd: root }));
    const result = await commitFromPage("pile", { message: "feat: b", paths: ["b.ts"], push: true, change: "2", label: "B" }, SCRIPT);
    expect(result.ok).toBe(false);
    expect(result.failed).toBe("commit");
    expect(result.error).toContain("types broke in b.ts");
    const [, message] = vi.mocked(runner.sendUserMessage).mock.calls[0]!;
    expect(message).toContain('Change 2 ("B") couldn\'t be committed');
    expect(message).toContain("types broke in b.ts");
  });

  it("keeps the end of a long refusal, where the reason is", async () => {
    const { root } = repo();
    fs.writeFileSync(path.join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nhead -c 5000 /dev/zero | tr '\\0' x\necho ' the reason' >&2\nexit 1\n", { mode: 0o755 });
    cards.set("pile", card("pile", { cwd: root }));
    const result = await commitFromPage("pile", { message: "m", paths: ["b.ts"], push: false }, SCRIPT);
    expect(result.error?.startsWith("…")).toBe(true);
    expect(result.error?.length).toBe(3001);
    expect(result.error).toContain("the reason");
  });

  it("reports a push that fails after the commit went in", async () => {
    const { root } = repo();
    git(root, "remote", "set-url", "origin", path.join(tmp, "missing.git"));
    cards.set("pile", card("pile", { cwd: root }));
    const result = await commitFromPage("pile", { message: "feat: a", paths: ["a.ts"], push: true }, SCRIPT);
    expect(result).toMatchObject({ ok: false, failed: "push" });
    expect(result.hash).toBe(git(root, "rev-parse", "--short", "HEAD"));
    expect(vi.mocked(runner.sendUserMessage).mock.calls[0]![1]).toContain(`A change was committed as ${result.hash}, but \`git push\` failed`);
  });

  it("reports a card that can't move to Done, and runs commits one at a time", async () => {
    const { root } = repo();
    cards.set("pile", card("pile", { cwd: root }));
    const [first, second] = await Promise.all([
      commitFromPage("pile", { message: "feat: a", paths: ["a.ts"], push: false, done: "gone" }, SCRIPT),
      commitFromPage("pile", { message: "feat: b", paths: ["b.ts"], push: false }, SCRIPT),
    ]);
    expect(first).toMatchObject({ ok: false, failed: "done", error: "No such card." });
    expect(second.ok).toBe(true);
    expect(git(root, "log", "--format=%s", "-2")).toBe("feat: b\nfeat: a");
  });

  it("throws for a card that's gone", async () => {
    await expect(commitFromPage("gone", { message: "m", paths: ["a"], push: false }, SCRIPT)).rejects.toThrow("No such card");
  });
});

describe("failureMessage", () => {
  it("says what got done before the step that failed", () => {
    const req = { message: "m", paths: ["a"], push: true, label: "Tips" };
    expect(failureMessage(req, { ok: false, failed: "done", hash: "abc", pushed: true, error: "x" })).toContain(
      'Change ("Tips") was committed as abc and pushed, but moving its card to Done failed:\n\nx',
    );
    expect(failureMessage(req, { ok: false, failed: "done", hash: "abc", error: "x" })).toContain("committed as abc, but moving");
  });
});

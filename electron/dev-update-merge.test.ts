import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devGit, runCommand, type Run } from "./dev-update.cjs";
import { cardsEditingFrom, conflictMessage, refusedFiles } from "./dev-update-merge.cjs";

// A real repo: "origin" moves main ahead, "work" is the checkout with other cards' uncommitted edits.
let root: string;
let work: string;
let backups: string;
const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (dir: string, f: string, text: string) => fs.writeFileSync(path.join(dir, f), text);
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf8");
const lines = (...l: string[]) => `${l.join("\n")}\n`;
const README = lines("# Title", "", "intro", "", "middle", "", "features", "", "end");

function commitAll(dir: string, msg: string) {
  g(dir, "add", "-A");
  g(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-devmerge-"));
  const origin = path.join(root, "origin");
  work = path.join(root, "work");
  backups = path.join(root, "backups");
  fs.mkdirSync(origin);
  g(origin, "init", "-q", "-b", "main");
  write(origin, "README.md", README);
  write(origin, "ROADMAP.md", lines("one", "two", "three"));
  commitAll(origin, "first");
  g(root, "clone", "-q", origin, work);
  // origin/main moves on: a paragraph near the end of each file.
  write(origin, "README.md", README.replace("end", "the new end"));
  write(origin, "ROADMAP.md", lines("one", "two", "THREE"));
  commitAll(origin, "second");
  g(work, "fetch", "-q", "origin", "main");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const target = () => g(work, "rev-parse", "FETCH_HEAD");
const head = () => g(work, "rev-parse", "HEAD");

describe("pull over other cards' dirty files", () => {
  it("merges clean edits in place, backs them up, and leaves them uncommitted on the new HEAD", async () => {
    write(work, "README.md", README.replace("intro", "a card's new intro"));
    write(work, "ROADMAP.md", lines("ONE", "two", "three"));
    const to = target();
    await devGit({ dir: work, backupRoot: backups }).pull(head(), to);
    expect(head()).toBe(to);
    expect(read(work, "README.md")).toBe(README.replace("intro", "a card's new intro").replace("end", "the new end"));
    expect(read(work, "ROADMAP.md")).toBe(lines("ONE", "two", "THREE"));
    expect(g(work, "diff", "--name-only").split("\n")).toEqual(["README.md", "ROADMAP.md"]);
    const stamp = fs.readdirSync(backups)[0] ?? "";
    expect(read(path.join(backups, stamp), "ROADMAP.md")).toBe(lines("ONE", "two", "three"));
  });

  it("changes nothing and names the files and the cards that edited them on a conflict", async () => {
    write(work, "README.md", README.replace("intro", "a card's new intro"));
    write(work, "ROADMAP.md", lines("one", "two", "three!"));
    const from = head();
    const cardsEditing = vi.fn((files: string[]) => Promise.resolve(Object.fromEntries(files.map((f) => [f, ["Fix roadmap"]]))));
    await expect(devGit({ dir: work, backupRoot: backups, cardsEditing }).pull(from, target())).rejects.toThrow(
      "Open cards' uncommitted edits to ROADMAP.md (“Fix roadmap”) change the same lines as origin/main, so Weft can't update without overwriting them. Commit those cards, then check again.",
    );
    expect(cardsEditing).toHaveBeenCalledWith(["ROADMAP.md"]);
    expect(head()).toBe(from);
    expect(read(work, "README.md")).toBe(README.replace("intro", "a card's new intro"));
    expect(read(work, "ROADMAP.md")).toBe(lines("one", "two", "three!"));
    expect(fs.existsSync(backups)).toBe(false);
  });

  it("puts the working copies back when the fast-forward still fails after restoring them", async () => {
    write(work, "ROADMAP.md", lines("ONE", "two", "three"));
    let merges = 0;
    const run: Run = (cmd, args, opts) => {
      if (args[0] === "merge" && ++merges === 2) return Promise.reject(new Error("fatal: index.lock exists"));
      return runCommand(cmd, args, opts);
    };
    const from = head();
    await expect(devGit({ dir: work, run, backupRoot: backups }).pull(from, target())).rejects.toThrow(
      "git couldn't fast-forward: fatal: index.lock exists",
    );
    expect(head()).toBe(from);
    expect(read(work, "ROADMAP.md")).toBe(lines("ONE", "two", "three"));
  });

  it("keeps git's own error without a backup folder to merge with", async () => {
    write(work, "ROADMAP.md", lines("ONE", "two", "three"));
    await expect(devGit({ dir: work }).pull(head(), target())).rejects.toThrow(/couldn't fast-forward: error: Your local changes/);
  });
});

describe("helpers", () => {
  it("refusedFiles reads git's list, or null for another refusal", () => {
    const msg = "error: Your local changes to the following files would be overwritten by merge:\n\tREADME.md\n\tdocs/ROADMAP.md\nPlease commit your changes or stash them before you merge.\nAborting";
    expect(refusedFiles(msg)).toEqual(["README.md", "docs/ROADMAP.md"]);
    expect(refusedFiles("fatal: Not possible to fast-forward, aborting.")).toBeNull();
    expect(refusedFiles(undefined)).toBeNull();
  });

  it("conflictMessage falls back to file names", () => {
    expect(conflictMessage(["a.md", "b.md", "c.md"])).toBe(
      "Uncommitted edits to a.md, b.md and c.md change the same lines as origin/main, so Weft can't update without overwriting them. Commit those cards, then check again.",
    );
    expect(conflictMessage(["a.md", "b.md"], { "b.md": ["X", "Y"] })).toMatch(/^Open cards' uncommitted edits to a.md and b.md \(“X” and “Y”\)/);
  });

  it("cardsEditingFrom finds open cards by touchedFiles, and nothing when the server is away or fails", async () => {
    const cards = [
      { id: "1", title: "Docs", column: "review", touchedFiles: ["/w/README.md"] },
      { id: "2", title: "Shipped", column: "done", touchedFiles: ["/w/README.md"] },
      { id: "3", title: "Old", column: "review", archived: true, touchedFiles: ["/w/README.md"] },
      { id: "4", column: "running", touchedFiles: ["/w/README.md"] },
    ];
    const fetchImpl = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ cards }) }));
    const lookup = cardsEditingFrom({ getServer: () => ({ url: "http://s" }), dir: "/w", fetchImpl });
    expect(await lookup(["README.md", "x.md"])).toEqual({ "README.md": ["Docs", "4"], "x.md": [] });
    expect(await cardsEditingFrom({ getServer: () => null, dir: "/w", fetchImpl })(["a"])).toEqual({});
    const broken = vi.fn(() => Promise.resolve({ json: () => Promise.reject(new Error("bad")) }));
    expect(await cardsEditingFrom({ getServer: () => ({ url: "http://s" }), dir: "/w", fetchImpl: broken })(["a"])).toEqual({});
  });
});

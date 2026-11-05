import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { clashes, claimKey, splitClaim, WHOLE_FILE } from "./claims";
import { busyInFolder } from "./overlap";
import { isMarkdownFile, markdownBlocks } from "./symbols-markdown";
import type { Card } from "./types";
import { workDir } from "./work-dir";

// Commit your own lines of a shared doc. `git commit -- MAP.md` takes the whole file, so a card's commit
// used to carry another card's half-written bullet. Before a commit, for each Markdown path where another
// busy card holds blocks (lib/symbols-markdown.ts), this builds the file as HEAD plus every hunk but theirs,
// writes it as a blob and leaves a note in .git/weft-held; /weft:done's commit.sh commits that blob through a
// temp index. The note carries HEAD and the working file's blob: if either moved, commit.sh ignores it and
// commits the path as ever, so the worst case is today's behaviour and nobody's lines are lost. The held
// hunks stay in the working tree, for their own card's commit.
//
// A note, not an env var: a warm spare's env is fixed before it has a card, and only the guard knows which
// card is committing. Blocks held by a card that isn't busy go in: a Review card is finished, and leaving its
// lines out would give the commit walk-through nothing to commit.

const run = promisify(execFile);

async function git(root: string, args: string[]) {
  return (await run("git", ["-C", root, ...args], { maxBuffer: 64 << 20 })).stdout;
}

async function writeBlob(root: string, text: string) {
  const job = run("git", ["-C", root, "hash-object", "-w", "--stdin"]);
  job.child.stdin?.end(text);
  return (await job).stdout.trim();
}

export interface Hunk {
  // 1-based lines, as in `@@ -oldStart,oldLines +newStart,newLines @@`.
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({ oldStart: Number(m[1]), oldLines: Number(m[2] ?? 1), newStart: Number(m[3]), newLines: Number(m[4] ?? 1) });
  }
  return hunks;
}

// HEAD's lines with these hunks of the working file applied, the rest left as HEAD had them.
export function applyHunks(base: string, work: string, hunks: Hunk[]) {
  const before = base.split("\n");
  const after = work.split("\n");
  const out: string[] = [];
  let at = 0;
  for (const h of hunks) {
    // A pure insertion's oldStart is the line above it; anything else names its own first line.
    const from = h.oldLines ? h.oldStart - 1 : h.oldStart;
    out.push(...before.slice(at, from), ...after.slice(h.newStart - 1, h.newStart - 1 + h.newLines));
    at = from + h.oldLines;
  }
  return [...out, ...before.slice(at)].join("\n");
}

// The block names a hunk's new lines sit in; a pure deletion goes by the line after it.
function blocksOf(blocks: ReturnType<typeof markdownBlocks>, h: Hunk) {
  const first = h.newLines ? h.newStart - 1 : h.newStart;
  const last = first + Math.max(h.newLines, 1) - 1;
  return blocks.filter((b) => b.from <= last && b.to >= first).map((b) => b.name);
}

// The hunks that are this card's to commit: all but those in a block another card holds and this one doesn't.
export function ownHunks(work: string, hunks: Hunk[], file: string, mine: string[], theirs: string[]) {
  const blocks = markdownBlocks(work);
  return hunks.filter((h) => {
    const keys = blocksOf(blocks, h).map((name) => claimKey(file, name));
    const held = keys.some((k) => theirs.some((t) => clashes(k, t)));
    return !held || keys.some((k) => mine.some((m) => clashes(k, m)));
  });
}

export const heldDir = (gitDir: string) => path.join(gitDir, "weft-held");
// commit.sh names a note the same way, with `git hash-object --stdin` over the path: a blob's sha.
export const heldNote = (rel: string) => createHash("sha1").update(`blob ${Buffer.byteLength(rel)}\0${rel}`).digest("hex");

// This one path: what stays out of the commit, written as a note. True when it held anything back.
async function holdPath(root: string, notes: string, rel: string, head: string, card: Card, others: Card[]) {
  const file = path.join(root, rel);
  const note = path.join(notes, heldNote(rel));
  fs.rmSync(note, { force: true });
  const claimsOn = (c: Card) => (c.claims ?? []).filter((k) => splitClaim(k).file === file);
  // A whole-file claim doesn't say which lines are whose, so it can't be split.
  const theirs = others.flatMap(claimsOn).filter((k) => splitClaim(k).symbol !== WHOLE_FILE);
  if (!theirs.length || !fs.existsSync(file)) return false;
  const tracked = await git(root, ["ls-tree", "--name-only", "HEAD", "--", rel]);
  if (!tracked.trim()) return false;
  const hunks = parseHunks(await git(root, ["diff", "--unified=0", "--no-color", "--no-ext-diff", "HEAD", "--", rel]));
  const work = fs.readFileSync(file, "utf8");
  const own = ownHunks(work, hunks, file, claimsOn(card), theirs);
  if (own.length === hunks.length) return false;
  const base = await git(root, ["show", `HEAD:${rel}`]);
  const blob = await writeBlob(root, applyHunks(base, work, own));
  const worktree = (await git(root, ["hash-object", "--", rel])).trim();
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(note, `${head}\n${worktree}\n${blob}\n`);
  return true;
}

// Leaves a note for each of these repo-relative paths with lines to hold back from this card's commit, and
// returns those paths. Never throws: failing to hold back only means committing the path whole, as ever.
export async function holdBack(root: string, paths: string[], card: Card, cards: Card[]): Promise<string[]> {
  const docs = paths.filter(isMarkdownFile);
  if (!docs.length) return [];
  try {
    const others = busyInFolder(cards, workDir(card), card.id);
    const head = (await git(root, ["rev-parse", "HEAD"])).trim();
    const notes = heldDir((await git(root, ["rev-parse", "--absolute-git-dir"])).trim());
    const held: string[] = [];
    for (const rel of docs) if (await holdPath(root, notes, rel, head, card, others)) held.push(rel);
    return held;
  } catch (err) {
    console.error("commit-held: couldn't hold lines back", err);
    return [];
  }
}

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { entriesFor, releaseProject, textsFor } from "./changelog";
import { bulletOf, renderFile } from "./changelog-render";
import { globalSingleton } from "./global-singleton";

// Weft keeps each project's CHANGELOG.md itself, in the background, so nobody runs a release step: right after a
// card's commit lands (lib/changelog-stamp.ts, and the commit walk-through in lib/pile-commit.ts) the committed entries
// are written under Unreleased and CHANGELOG.md is committed on its own, by path. When that card's commit bumped
// package.json's version, the same write moves Unreleased under `## [version] - date` instead, so the tag that follows
// has its notes (scripts/release-feed.mjs). A project with no CHANGELOG.md and no entries never gets one.

const run = promisify(execFile);
const git = (root: string, args: string[]) => run("git", ["-C", root, ...args], { timeout: 120_000, maxBuffer: 8 << 20 });

async function versionAt(root: string, rev: string): Promise<string | null> {
  try {
    const v = (JSON.parse((await git(root, ["show", `${rev}:package.json`])).stdout) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

// The version HEAD's commit bumped package.json to; null when it didn't.
export async function bumpedVersion(root: string): Promise<string | null> {
  const now = await versionAt(root, "HEAD");
  const before = now && (await versionAt(root, "HEAD~1"));
  return now && before && before !== now ? now : null;
}

const hasVersion = (text: string, version: string) => text.split("\n").some((line) => line.startsWith(`## [${version}]`));

const errorText = (err: unknown) => String((err as { stderr?: unknown }).stderr ?? err).trim().slice(0, 400);

// Commits CHANGELOG.md alone; a moment's retry when another commit holds git's index lock.
async function commitFile(root: string, message: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await git(root, ["add", "--", "CHANGELOG.md"]);
      await git(root, ["commit", "-q", "-m", message, "--", "CHANGELOG.md"]);
      return;
    } catch (err) {
      if (attempt >= 2 || !/index\.lock/.test(errorText(err))) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export interface WriteResult {
  // The CHANGELOG.md commit, short.
  commit?: string;
  released?: string;
  error?: string;
}

// Commits CHANGELOG.md if it differs from HEAD: from this write, or an earlier one whose commit failed.
async function commitIfDirty(root: string, message: string): Promise<WriteResult> {
  if (!(await git(root, ["status", "--porcelain", "--", "CHANGELOG.md"])).stdout.trim()) return {};
  try {
    await commitFile(root, message);
  } catch (err) {
    return { error: errorText(err) };
  }
  return { commit: (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim() };
}

// The version this write releases: the one HEAD bumped package.json to, unless the file already has it.
async function releasing(root: string, text: string | null) {
  const bumped = await bumpedVersion(root);
  return bumped && !(text && hasVersion(text, bumped)) ? bumped : undefined;
}

async function write(root: string, label: string, today: string): Promise<WriteResult> {
  const file = path.join(root, "CHANGELOG.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const entries = entriesFor(root).filter((e) => e.sha && !e.version);
  if (text === null && !entries.length) return {};
  const version = await releasing(root, text);
  const known = new Set([...textsFor(root)].map(bulletOf));
  const next = renderFile(text, entries, { known, ...(version ? { release: { version, date: today } } : {}) });
  if (next !== text) fs.writeFileSync(file, next);
  if (!version) return commitIfDirty(root, `docs(changelog): ${label}`);
  // The file holds the release now, committed or not, so its entries are released either way.
  releaseProject(root, version, undefined, { committedOnly: true });
  return { ...(await commitIfDirty(root, `docs(changelog): ${version}`)), released: version };
}

// One write at a time across every card: two would trip over git's index lock and each other's file.
export function writeChangelog(root: string, label: string, today = new Date().toISOString().slice(0, 10)): Promise<WriteResult> {
  const queue = globalSingleton("__weftChangelogWrite", (): { tail: Promise<unknown> } => ({ tail: Promise.resolve() }));
  const next = queue.tail.then(() => write(root, label, today)).catch((err: unknown) => ({ error: String(err) }));
  queue.tail = next;
  return next;
}

// The line a thread is told after its commit.
export function writeNote(r: WriteResult): string {
  if (r.error) return `Weft couldn't commit CHANGELOG.md (it will try again after the next commit): ${r.error}`;
  if (!r.commit) return "";
  return r.released ? `Weft wrote ${r.released}'s notes into CHANGELOG.md and committed them as ${r.commit}; tag after this.` : `Weft committed CHANGELOG.md as ${r.commit}.`;
}

import { execFileSync } from "node:child_process";

// The git reads the changelog's stamp needs (lib/changelog-stamp.ts, lib/changelog-tool.ts): HEAD, the commits a call
// added, the paths and subject of each one, and a sha a thread names. Each is null or empty when git can't answer.

const git = (root: string, args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const attempt = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch {
    return fallback;
  }
};

export const head = (root: string): string | null => attempt(() => git(root, ["rev-parse", "HEAD"]) || null, null);

// The full sha of a commit `ref` names (a short sha, a branch), or null when it isn't one.
export const resolveCommit = (root: string, ref: string): string | null =>
  attempt(() => git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) || null, null);

// The paths a commit changed, repo-relative; a merge lists what it changed against each parent.
export const commitFiles = (root: string, sha: string): string[] =>
  attempt(() => [...new Set(git(root, ["diff-tree", "--root", "-m", "-r", "--no-commit-id", "--name-only", sha]).split("\n").filter(Boolean))], []);

// A commit's subject line, or "" when git can't read it.
export const subjectOf = (root: string, sha: string): string => attempt(() => git(root, ["log", "-1", "--format=%s", sha]), "");

// A call can land more than one commit: those from `from` (exclusive; "" when there was no HEAD) to `to`, oldest first.
const MAX_COMMITS = 50;
export function commitsSince(root: string, from: string, to: string): string[] {
  if (!from) return [to];
  const list = attempt(() => git(root, ["rev-list", "--reverse", `${from}..${to}`]).split("\n").filter(Boolean), [to]);
  return list.length ? list.slice(-MAX_COMMITS) : [to];
}

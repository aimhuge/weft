import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GitCommit } from "./slack-messages";

// Commits and pushes for Slack (docs/architecture/slack.md), read from each repo's reflog instead of hooked into
// every way Weft commits: a thread's commit.sh, the commit page's buttons, a worktree landing and your own terminal
// all append a line to .git/logs/HEAD, and every `git push` to .git/logs/refs/remotes/<remote>/<branch> with the
// message "update by push" (a fetch writes "fetch: …"). Reading only the bytes added since the last look is a stat
// per file per tick.

const run = promisify(execFile);


export interface ReflogEntry {
  old: string;
  sha: string;
  message: string;
}

export interface GitEvents {
  onCommits: (cwd: string, branch: string, commits: GitCommit[]) => void;
  onPush: (cwd: string, remoteRef: string, count: number) => void;
}

interface Repo {
  cwd: string;
  gitDir: string;
  commonDir: string;
}

const ZERO = /^0+$/;

// `<old> <new> <who> <when> <tz>\t<message>` per line; a line without the tab is skipped.
export function parseReflog(text: string): ReflogEntry[] {
  return text.split("\n").flatMap((line) => {
    const tab = line.indexOf("\t");
    if (tab < 0) return [];
    const [old, sha] = line.slice(0, tab).split(" ");
    return old && sha ? [{ old, sha, message: line.slice(tab + 1) }] : [];
  });
}

// "commit: fix x", "commit (amend): …", "commit (initial): …", "commit (merge): …"; not checkout, reset or rebase.
export function commitsOf(entries: ReflogEntry[]): GitCommit[] {
  return entries.flatMap((e) => {
    const m = /^commit(?: \([a-z]+\))?: (.*)$/.exec(e.message);
    return m ? [{ sha: e.sha, subject: String(m[1]) }] : [];
  });
}

export const pushesOf = (entries: ReflogEntry[]) => entries.filter((e) => e.message === "update by push");

// refs/heads/main → main; a detached HEAD has no branch to name.
export function branchOf(headFile: string): string {
  try {
    const head = fs.readFileSync(headFile, "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : "detached HEAD";
  } catch {
    return "HEAD";
  }
}

function filesUnder(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  } catch {
    return [];
  }
}

async function repoOf(cwd: string): Promise<Repo | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--absolute-git-dir", "--git-common-dir"], { cwd });
    // Two lines, always: the git dir, then the common dir (relative to cwd for the main worktree).
    const [gitDir, common] = stdout.trim().split("\n");
    return { cwd, gitDir: String(gitDir), commonDir: path.resolve(cwd, String(common)) };
  } catch {
    return null;
  }
}

// How many commits a push sent: old..new, or just the new tip's history (capped) for a branch's first push.
async function pushedCount(cwd: string, e: ReflogEntry): Promise<number> {
  const range = ZERO.test(e.old) ? [e.sha, "--max-count=50"] : [`${e.old}..${e.sha}`];
  try {
    const { stdout } = await run("git", ["rev-list", "--count", ...range], { cwd });
    return Number(stdout.trim()) || 1;
  } catch {
    return 1;
  }
}

// Watches the folders it's given. The first look at a file only records its size, so what happened before Weft
// started is never posted; a remote ref file that appears later (a branch's first push) is read from its start.
export function createGitWatch(events: GitEvents) {
  const repos = new Map<string, Repo | null>();
  const offsets = new Map<string, number>();
  // Repos looked at once already: a remote ref file that turns up in one of these is a branch's first push.
  const primed = new Set<string>();

  function added(file: string, isNew: boolean): string {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return "";
    }
    const from = offsets.get(file) ?? (isNew ? 0 : size);
    offsets.set(file, size);
    if (size <= from) return "";
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  }

  async function look(repo: Repo, isNew: boolean) {
    const commits = commitsOf(parseReflog(added(path.join(repo.gitDir, "logs", "HEAD"), false)));
    if (commits.length) events.onCommits(repo.cwd, branchOf(path.join(repo.gitDir, "HEAD")), commits);
    const remotes = path.join(repo.commonDir, "logs", "refs", "remotes");
    for (const file of filesUnder(remotes)) {
      for (const push of pushesOf(parseReflog(added(file, isNew && !offsets.has(file))))) {
        events.onPush(repo.cwd, path.relative(remotes, file), await pushedCount(repo.cwd, push));
      }
    }
  }

  // One pass over the folders: a repo seen twice (two folders in one repo) is read once.
  async function tick(folders: string[]) {
    const seen = new Set<string>();
    for (const cwd of folders) {
      if (!repos.has(cwd)) repos.set(cwd, await repoOf(cwd));
      const repo = repos.get(cwd);
      if (!repo || seen.has(repo.gitDir)) continue;
      seen.add(repo.gitDir);
      await look(repo, primed.has(repo.gitDir));
      primed.add(repo.gitDir);
    }
  }

  return { tick };
}

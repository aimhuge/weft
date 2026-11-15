// Catching a synced folder up to the other end's commit (docs/architecture/folder-sync.md#catching-up). Sync runs only
// while both checkouts sit on the same commit, and nothing used to move the one that fell behind: a worker never pulls,
// so the folder paused at the first commit and stayed paused. Now the end that is behind follows by itself.
//
//   ahead     this end already has the other's commit: the other end is the one to move
//   missing   the commit isn't on origin's copy of this branch as this end knows it: fetch (never more than once in
//             20 s, and for one commit 20 s after a miss, then 40, up to 5 min); still not there, wait
//   diverged  each has commits the other lacks: yours to bring together
//   clash     a file changed on this end is also changed by the newer commits, to something else: nothing moves
//   moved     fast-forwarded. Uncommitted work stays as it was, and a file that already holds the commit's version
//             (it synced over before the commit was made) is staged first, so git doesn't see it as in the way
//
// The commit is a name from the network. It must be a full sha, on origin's copy of the branch this end is already on
// (a commit that is merely in this checkout, on another branch or in a stash, is not enough), and it is only ever
// fast-forwarded to.
import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultGit, type Git } from "./handover-push";
import { blobSha } from "./tree-sync-fs";

export type Followed =
  | { moved: true }
  | { moved: false; why: "ahead" | "missing" | "diverged" | "clash" | "failed"; reason: string };

export type Follow = (at: { branch: string; head: string }, want: string) => Promise<Followed>;

const SHA = /^[0-9a-f]{40}$/;
const ZERO = /^0+$/;
// The repo's own hooks don't run on a fetch or a move the network asked for, and neither starts a gc. Filters the
// checkout has configured (LFS, eol) still run, as on any checkout: the other end can't define one.
const QUIET = ["-c", "core.hooksPath=/dev/null", "-c", "gc.auto=0", "-c", "maintenance.auto=false"];
const FETCH_EVERY = 20_000;
const FETCH_SLOWEST = 5 * 60_000;
const EXEC = "100755";
const short = (sha: string) => sha.slice(0, 7);

const no = (why: Exclude<Followed, { moved: true }>["why"], reason: string): Followed => ({ moved: false, why, reason });

export interface Change {
  path: string;
  // The blob before and after; null where the range adds or removes the file.
  was: string | null;
  will: string | null;
  // The file's mode after: 100644, 100755, or 000000 when it goes.
  mode: string;
  // A plain file on both sides: a symlink or a submodule is left for git to judge.
  plain: boolean;
}

// `git diff --raw -z`: ":<mode> <mode> <sha> <sha> <status>", then the path, each ended by a NUL.
export function parseRaw(raw: string): Change[] {
  const parts = raw.split("\0");
  const out: Change[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) \S+$/.exec(parts[i] as string);
    if (!m) continue;
    const file = (mode: string) => mode === "000000" || mode === "100644" || mode === EXEC;
    out.push({
      path: parts[i + 1] as string,
      was: ZERO.test(m[3] as string) ? null : (m[3] as string),
      will: ZERO.test(m[4] as string) ? null : (m[4] as string),
      mode: m[2] as string,
      plain: file(m[1] as string) && file(m[2] as string),
    });
  }
  return out;
}

// What's on disk in a checkout, for the paths a range changes: a file's blob id, null when nothing is there, "other"
// for anything else. A file sitting where the path needs a folder is "other" too: git would remove it to make room,
// even an ignored one.
function disk(root: string) {
  const folders = new Map<string, Promise<boolean>>();
  // Whether every folder down to `dir` is a folder, or isn't there yet.
  const clear = (dir: string): Promise<boolean> => {
    if (dir === root) return Promise.resolve(true);
    let known = folders.get(dir);
    if (!known) {
      known = clear(path.dirname(dir)).then(async (above) => {
        if (!above) return false;
        const stat = await fs.lstat(dir).catch(() => null);
        return !stat || stat.isDirectory();
      });
      folders.set(dir, known);
    }
    return known;
  };
  return async (p: string): Promise<string | null> => {
    const file = path.join(root, ...p.split("/"));
    if (!(await clear(path.dirname(file)))) return "other";
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) return null;
    if (!stat.isFile()) return "other";
    return blobSha(await fs.readFile(file));
  };
}

// Gives a file the executable bit the commit has for it, leaving its other permissions alone.
async function setExec(file: string, exec: boolean): Promise<void> {
  const { mode } = await fs.stat(file);
  if (((mode & 0o100) !== 0) !== exec) await fs.chmod(file, exec ? mode | 0o111 : mode & ~0o111);
}

const few = (paths: string[]) => (paths.length > 3 ? `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more` : paths.join(", "));
const lit = (paths: string[]) => paths.map((p) => `:(literal)${p}`);

// One checkout's follower. `other` is the other end's name, for the reasons it gives.
export function follower(root: string, other: string, o: { git?: Git; now?: () => number } = {}): Follow {
  const git = o.git ?? defaultGit;
  const now = o.now ?? Date.now;
  const ok = (args: string[]) => git(root, args).then(() => true, () => false);
  const within = (a: string, b: string) => ok(["merge-base", "--is-ancestor", a, b]);
  // The last fetch, the commit it was for, and how long to wait after that commit's next miss.
  let fetchedAt = -Infinity;
  let asked = "";
  let every = FETCH_EVERY;
  let nextAt = 0;

  // Whether the commit is on origin's copy of the branch, asking origin when this end doesn't know of it yet.
  async function pushed(want: string, branch: string): Promise<boolean> {
    const there = () => within(want, `refs/remotes/origin/${branch}`);
    if (await there()) return true;
    if (asked !== want) {
      asked = want;
      every = FETCH_EVERY;
      nextAt = 0;
    }
    // A new commit is asked about at once, but never sooner than 20 s after the last fetch, whatever names arrive.
    if (now() < Math.max(nextAt, fetchedAt + FETCH_EVERY)) return false;
    fetchedAt = now();
    await ok([...QUIET, "fetch", "--quiet", "--no-tags", "origin", branch]);
    if (await there()) return true;
    nextAt = now() + every;
    every = Math.min(every * 2, FETCH_SLOWEST);
    return false;
  }

  // The index's blob for each path staged away from HEAD (null for a staged removal).
  async function staged(head: string): Promise<Map<string, string | null>> {
    const raw = await git(root, ["diff", "--cached", "--raw", "-z", "--no-renames", "--abbrev=40", head]);
    return new Map(parseRaw(raw).map((c) => [c.path, c.will]));
  }

  // Each plain file the range changes, against this checkout: untouched (left to git), already the commit's version,
  // or this end's own work, on disk or staged, which a move would lose.
  async function sort(head: string, want: string): Promise<{ already: Change[]; clash: string[] }> {
    const changes = parseRaw(await git(root, ["diff", "--raw", "-z", "--no-renames", "--abbrev=40", head, want]));
    const index = await staged(head);
    const on = disk(root);
    const already: Change[] = [];
    const clash: string[] = [];
    for (const c of changes.filter((x) => x.plain)) {
      const here = await on(c.path);
      if (here === c.was) continue;
      if (here !== c.will || (index.has(c.path) && index.get(c.path) !== c.will)) clash.push(c.path);
      else if (!index.has(c.path)) already.push(c);
    }
    return { already, clash };
  }

  // The fast-forward. Staged as the commit has it (its mode too: a file that synced over arrived without its
  // executable bit), a file that already holds the commit's version is no longer in the way.
  async function land(already: Change[], want: string): Promise<Followed> {
    const paths = lit(already.map((c) => c.path));
    try {
      for (const c of already.filter((x) => x.will)) await setExec(path.join(root, ...c.path.split("/")), c.mode === EXEC);
      if (paths.length) await git(root, ["add", "-A", "--force", "--", ...paths]);
      await git(root, [...QUIET, "merge", "--ff-only", "--quiet", want]);
      return { moved: true };
    } catch (err) {
      if (paths.length) await ok(["reset", "--quiet", "--", ...paths]);
      return no("failed", `Couldn't move to commit ${short(want)}: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  return async function follow(at, want) {
    if (!SHA.test(want) || !SHA.test(at.head) || !at.branch) return no("failed", "That isn't a commit.");
    if (await within(want, at.head)) return no("ahead", `Waiting for ${other} to catch up to ${short(at.head)}`);
    if (!(await pushed(want, at.branch))) return no("missing", `Waiting for commit ${short(want)} to be pushed`);
    if (!(await within(at.head, want))) return no("diverged", "Each side has commits the other lacks: push and pull to bring them together");
    const { already, clash } = await sort(at.head, want);
    if (clash.length) return no("clash", `${clash.length === 1 ? "1 uncommitted file clashes" : `${clash.length} uncommitted files clash`} with newer commits (${few(clash)})`);
    return land(already, want);
  };
}

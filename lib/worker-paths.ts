// Where a Weft Worker runs a command (docs/architecture/weft-worker.md#the-repo-on-the-worker). A command's folder
// is the project's name on the worker, not a Mac path: it resolves under the work root, one persistent checkout per
// project, cloned the first time a run names its repo.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// The checkout a command's folder names, under root. A folder is one or more plain path segments: absolute paths,
// `..` and hidden segments are refused, so a command can't reach outside the work root.
export function repoPath(root: string, folder: string): string {
  const parts = folder.trim().split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p.startsWith(".") || p.includes("\\"))) throw new Error(`"${folder}" isn't a project folder name on this worker.`);
  return path.join(root, ...parts);
}

// Only https and ssh git URLs: a run can't make the worker clone from a local path or run a helper protocol.
const isGitUrl = (url: string) => /^(https:\/\/|git@|ssh:\/\/)[\w.@:/~+-]+$/.test(url);

export type Exec = (cmd: string, args: string[], opts: { cwd?: string }) => Promise<unknown>;
// A service has no terminal: git must fail at once rather than ask for a password.
const exec: Exec = (cmd, args, opts) => run(cmd, args, { ...opts, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 10 * 60_000 });

// A clone in progress. Hidden, so repoPath refuses it and no command can reach a half-made checkout.
const TEMP_PREFIX = ".cloning-";
// Longer than a clone can run. A temp folder this old lost its worker mid-clone: nothing else would ever remove it.
const STALE_TEMP_MS = 60 * 60_000;

function sweepStaleTemps(parent: string) {
  for (const name of fs.readdirSync(parent)) {
    const temp = path.join(parent, name);
    if (name.startsWith(TEMP_PREFIX) && Date.now() - fs.statSync(temp).mtimeMs > STALE_TEMP_MS) fs.rmSync(temp, { recursive: true, force: true });
  }
}

// Whether the checked-in tree stores files in LFS. Git prints no output and exits non-zero when nothing matches.
const usesLfs = (temp: string, sh: Exec) =>
  sh("git", ["-C", temp, "grep", "-q", "-e", "filter=lfs", "HEAD", "--", ".gitattributes", ":(glob)**/.gitattributes"], {}).then(
    () => true,
    () => false,
  );

// The history first, the files after, so LFS is checked before a checkout can fail on it or, on a box with no lfs
// filter set up, succeed with pointer files where the real ones belong. The local install covers that second box.
async function cloneInto(temp: string, repo: string, sh: Exec) {
  await sh("git", ["clone", "--no-checkout", "--", repo, temp], {});
  if (await usesLfs(temp, sh)) {
    await sh("git", ["-C", temp, "lfs", "install", "--local"], {}).catch(() => {
      throw new Error(`${repo} stores files in Git LFS, and this worker doesn't have git-lfs. Install it (brew install git-lfs, or apt-get install git-lfs), then send the clone again.`);
    });
  }
  // reset, not checkout: an empty repo has no HEAD to check out, and it's a clone all the same.
  await sh("git", ["-C", temp, "reset", "--hard", "-q"], {});
}

// Makes sure the checkout exists: a folder that's there is used as it is (the worker never pulls over a card's
// work), a missing one is cloned from repo, and a missing one with no repo is an error the command reports. The clone
// lands in a temp folder and is renamed into place whole, so a folder at dir always means a complete clone.
export async function materialise(dir: string, repo: string | undefined, sh: Exec = exec): Promise<"present" | "cloned"> {
  if (fs.existsSync(dir)) return "present";
  if (!repo) throw new Error(`There's no ${path.basename(dir)} checkout on this worker yet. Send the run with its git URL to clone it.`);
  if (!isGitUrl(repo)) throw new Error(`"${repo}" isn't a git URL this worker clones (https or ssh).`);
  const parent = path.dirname(dir);
  fs.mkdirSync(parent, { recursive: true });
  sweepStaleTemps(parent);
  const temp = fs.mkdtempSync(path.join(parent, TEMP_PREFIX));
  try {
    await cloneInto(temp, repo, sh);
    fs.renameSync(temp, dir);
    return "cloned";
  } catch (err) {
    // A clone runs off the daemon's poll loop, so a run can finish the same checkout first.
    if ((err as NodeJS.ErrnoException).code === "ENOTEMPTY") return "present";
    throw err;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

// A repo's URL without what differs between its forms: https or ssh, a `.git` on the end.
const sameRepo = (url: string) => url.trim().replace(/^(https:\/\/([^@/]+@)?|ssh:\/\/git@|git@)/, "").replace(":", "/").replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();

// The `clone` command: like a run's materialise, but a folder that's already there has to be this repo. Two owners'
// repos can share a name, and saying "done" for the wrong one would send the next run into it.
export async function cloneProject(dir: string, repo: string, sh: Exec = exec): Promise<"present" | "cloned"> {
  const result = await materialise(dir, repo, sh);
  if (result === "cloned") return result;
  const origin = await sh("git", ["-C", dir, "remote", "get-url", "origin"], {}).then(
    (out) => {
      const { stdout } = out as { stdout?: unknown };
      return typeof stdout === "string" ? stdout : "";
    },
    () => "",
  );
  if (sameRepo(origin) !== sameRepo(repo)) throw new Error(`There's already a different ${path.basename(dir)} on this worker${origin.trim() ? ` (${origin.trim()})` : ""}.`);
  return result;
}

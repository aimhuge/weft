import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { globalSingleton } from "./global-singleton";
import { hookedRepos } from "./github-hooks";
import { ghError, issueSyncFolders, issueSyncStatus, repoOf } from "./github-issues";
import { issueWorkflow } from "./settings";
import type { GithubAccount, GithubFolder, GithubStatus } from "./github-view";

// The GitHub drawer's status (lib/github-view.ts): who the gh CLI is signed in as, and each board folder's repo,
// issue sync and webhook (lib/github-hooks.ts). A folder's repo is kept for REPO_TTL (a miss for MISS_TTL) since
// remotes rarely change; the account is asked each time, so "Check again" after `gh auth login` shows it at once.

const run = promisify(execFile);
export const REPO_TTL = 10 * 60_000;
export const MISS_TTL = 60_000;

const repos = () => globalSingleton("__weftGithubRepos", () => new Map<string, { at: number; repo: string | null; error: string | null }>());

export async function githubAccount(): Promise<{ account: GithubAccount | null; error: string | null }> {
  try {
    const { stdout } = await run("gh", ["api", "user", "--jq", ".login"], { timeout: 10_000 });
    const login = stdout.trim();
    if (!login) return { account: null, error: "The GitHub CLI isn't logged in. Run gh auth login." };
    return { account: { login, url: `https://github.com/${login}` }, error: null };
  } catch (err) {
    return { account: null, error: ghError(err, "") };
  }
}

async function folderRepo(folder: string, now: number): Promise<{ repo: string | null; error: string | null }> {
  const cache = repos();
  const hit = cache.get(folder);
  if (hit && now - hit.at < (hit.repo ? REPO_TTL : MISS_TTL)) return hit;
  let found: { repo: string | null; error: string | null };
  if (!fs.existsSync(folder)) found = { repo: null, error: `${path.basename(folder)} isn't there anymore.` };
  else {
    try {
      found = { repo: await repoOf(folder), error: null };
    } catch (err) {
      found = { repo: null, error: (err as Error).message };
    }
  }
  cache.set(folder, { at: now, ...found });
  return found;
}

// Forget the cached repos (tests).
export function clearGithubRepos() {
  repos().clear();
}

export async function githubStatus(folders: string[], now = Date.now()): Promise<GithubStatus> {
  const [{ account, error }, hooks] = await Promise.all([
    githubAccount(),
    hookedRepos().then(
      (h) => ({ ...h, error: null }),
      (err: unknown) => ({ signedIn: true, repos: [] as string[], error: `Couldn't read your webhooks: ${(err as Error).message}` }),
    ),
  ]);
  const hooked = new Set(hooks.repos.map((r) => r.toLowerCase()));
  const syncing = new Set(issueSyncFolders());
  const last = issueSyncStatus();
  const rows: GithubFolder[] = await Promise.all(
    folders.map(async (folder) => {
      // Signed out, every gh call fails the same way: say it once, at the top.
      const { repo, error: repoError } = account ? await folderRepo(folder, now) : { repo: null, error: null };
      const instant = Boolean(repo && hooked.has(repo.toLowerCase()));
      return {
        folder,
        repo,
        error: repoError,
        syncing: syncing.has(folder),
        last: last[folder] ?? null,
        instant,
        workflow: issueWorkflow(folder),
      };
    }),
  );
  return { account, error, weft: hooks.signedIn, instantError: hooks.error, folders: rows };
}

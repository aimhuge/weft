import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runClone } from "./clone-progress";
import { worktreeParent } from "./format";
import { listProjects } from "./settings";
import type { GithubRepo, LocalRepo } from "./types";
import { globalSingleton } from "./global-singleton";

// The folders the new-thread picker offers: recent projects, git repos found in the usual code
// folders, and the user's GitHub repos (through the gh CLI), which can be cloned in one step.

const run = promisify(execFile);
const HOME = os.homedir();
const ROOTS = ["dev", "code", "projects", "src", "Developer", "GitHub", "repos", "work", "Sites"].map((d) => path.join(HOME, d));
// How many folders a scan looks inside, so a huge code folder can't stall the picker.
const MAX_SCANNED = 1500;
const SKIP = new Set(["node_modules", "dist", "build", "vendor", "target", "Library"]);

// The repo's git directory: .git itself, or where a worktree's .git file points.
function gitDir(folder: string) {
  const dotGit = path.join(folder, ".git");
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return dotGit;
    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
    const target = match?.[1];
    return target ? path.resolve(folder, target.trim()) : null;
  } catch {
    return null;
  }
}

function readText(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function branchOf(dir: string) {
  const head = readText(path.join(dir, "HEAD")).trim();
  if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
  return head ? head.slice(0, 7) : undefined;
}

// "git@github.com:me/app.git" or "https://github.com/me/app" -> "me/app"
export function githubSlug(url: string) {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

const roots = globalSingleton("__weftRoots", () => new Map<string, string>());

// The project a folder belongs to: the main repo for a git worktree (live ones through their commondir,
// deleted ones through a .claude/worktrees path), otherwise the folder itself. Cached per folder.
export function projectRoot(cwd: string) {
  let root = roots.get(cwd);
  if (root) return root;
  const dir = gitDir(cwd);
  const common = dir ? readText(path.join(dir, "commondir")).trim() : "";
  const commonDir = common && dir ? path.resolve(dir, common) : "";
  root = path.basename(commonDir) === ".git" ? path.dirname(commonDir) : (worktreeParent(cwd) ?? cwd);
  roots.set(cwd, root);
  return root;
}

function originOf(dir: string) {
  // A worktree keeps its config in the main repo's git directory.
  const common = readText(path.join(dir, "commondir")).trim();
  const config = readText(path.join(common ? path.resolve(dir, common) : dir, "config"));
  const origin = /\[remote "origin"\]([^[]*)/.exec(config)?.[1] ?? "";
  const url = /^\s*url\s*=\s*(.+)$/m.exec(origin)?.[1];
  return url ? githubSlug(url) : undefined;
}

// The GitHub repo ("owner/name") a folder's origin points at, read from its git config; undefined for anything else.
export function githubRepoOf(folder: string) {
  const dir = gitDir(folder);
  return dir ? originOf(dir) : undefined;
}

// When the repo last changed: the latest of its HEAD, index, and last fetch.
function activityOf(dir: string) {
  let latest = 0;
  for (const file of ["HEAD", "index", "FETCH_HEAD"]) {
    try {
      latest = Math.max(latest, fs.statSync(path.join(dir, file)).mtimeMs);
    } catch {}
  }
  return latest;
}

function describe(folder: string, recentAt?: number): LocalRepo | null {
  const dir = gitDir(folder);
  if (!dir && recentAt === undefined) return null;
  return {
    path: folder,
    name: path.basename(folder),
    git: Boolean(dir),
    branch: dir ? branchOf(dir) : undefined,
    github: dir ? originOf(dir) : undefined,
    activity: dir ? activityOf(dir) : 0,
    recentAt,
  };
}

function subfolders(folder: string) {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP.has(d.name))
      .map((d) => path.join(folder, d.name));
  } catch {
    return [];
  }
}

const g = globalThis as unknown as {
  __weftRepos?: { at: number; repos: LocalRepo[] };
  __weftGithub?: { at: number; repos: GithubRepo[] };
};

// Recent projects first (git or not), then every repo found up to two levels into the code folders.
export function localRepos({ fresh = false } = {}): LocalRepo[] {
  if (!fresh && g.__weftRepos && Date.now() - g.__weftRepos.at < 20_000) return g.__weftRepos.repos;
  const found = new Map<string, LocalRepo>();
  for (const project of listProjects()) {
    if (!fs.existsSync(project.path)) continue;
    const repo = describe(project.path, project.lastUsedAt);
    if (repo) found.set(project.path, repo);
  }
  let scanned = 0;
  for (const root of ROOTS) {
    for (const child of subfolders(root)) {
      if (scanned++ > MAX_SCANNED) break;
      if (found.has(child)) continue;
      const repo = describe(child);
      if (repo) {
        found.set(child, repo);
        continue;
      }
      // A folder of repos, like ~/dev/my-org/*.
      for (const grandchild of subfolders(child)) {
        if (scanned++ > MAX_SCANNED) break;
        const nested = found.has(grandchild) ? null : describe(grandchild);
        if (nested) found.set(grandchild, nested);
      }
    }
  }
  const repos = [...found.values()].sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0) || b.activity - a.activity);
  g.__weftRepos = { at: Date.now(), repos };
  return repos;
}

function errorText(err: unknown) {
  const e = err as { stderr?: string; message?: string; code?: string };
  if (e.code === "ENOENT") return "The GitHub CLI isn't installed. brew install gh, then gh auth login.";
  const text = (e.stderr || e.message || String(err)).trim();
  if (/auth login|not logged/i.test(text)) return "The GitHub CLI isn't logged in. Run gh auth login.";
  return text.split("\n").slice(-3).join(" ");
}

// The user's GitHub repos (their own, collaborations, and their orgs'), most recently pushed first.
export async function githubRepos({ fresh = false } = {}): Promise<GithubRepo[]> {
  if (!fresh && g.__weftGithub && Date.now() - g.__weftGithub.at < 120_000) return withLocal(g.__weftGithub.repos);
  try {
    const { stdout } = await run(
      "gh",
      ["api", "user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member"],
      { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
    );
    const raw = JSON.parse(stdout) as {
      full_name: string;
      description: string | null;
      private: boolean;
      pushed_at: string | null;
    }[];
    const repos: GithubRepo[] = raw.map((r) => ({
      fullName: r.full_name,
      description: r.description ?? undefined,
      private: r.private,
      pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : 0,
    }));
    g.__weftGithub = { at: Date.now(), repos };
    return withLocal(repos);
  } catch (err) {
    throw new Error(errorText(err));
  }
}

// Marks the GitHub repos that are already cloned here.
function withLocal(repos: GithubRepo[]) {
  const local = new Map<string, string>();
  for (const repo of localRepos()) if (repo.github && !local.has(repo.github.toLowerCase())) local.set(repo.github.toLowerCase(), repo.path);
  return repos.map((r) => ({ ...r, localPath: local.get(r.fullName.toLowerCase()) }));
}

const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// A local clone of owner/repo: an existing one if there is one, otherwise a fresh clone in ~/dev.
export async function cloneRepo(fullName: string): Promise<string> {
  if (!FULL_NAME.test(fullName)) throw new Error("Pick a repo like owner/name.");
  const existing = localRepos({ fresh: true }).find((r) => r.github?.toLowerCase() === fullName.toLowerCase());
  if (existing) return existing.path;

  const parent = fs.existsSync(path.join(HOME, "dev")) ? path.join(HOME, "dev") : HOME;
  // FULL_NAME guarantees an owner/name pair.
  const name = fullName.split("/")[1] ?? fullName;
  let target = path.join(parent, name);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(parent, `${name}-${n}`);
  try {
    await runClone(fullName, target);
  } catch (err) {
    throw new Error(`Couldn't clone ${fullName}: ${errorText(err)}`);
  }
  g.__weftRepos = undefined;
  return target;
}

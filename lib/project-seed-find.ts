import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { statusOf } from "./copilot-sources";
import { repoOf, type GhIssue } from "./github-issues";
import { checkProject } from "./project-checks";
import { agentsSeed, checkSeeds, issueSeeds, todoSeed, type Seed } from "./project-seed";
import { listCards } from "./store";
import { migratePrompt, migrateTitle } from "./supabase-migrate";
import type { SupabaseStatus } from "./supabase-view";

// Looks a project over for its starter cards (lib/project-seed.ts): agent docs, Supabase migrations not applied,
// open GitHub issues for you, the production-ready tree's failing checks and the densest TODO cluster. Reads
// only. Each source is on its own: one that fails (no gh, no Supabase link, not a git repo) adds nothing.

const run = promisify(execFile);
const ISSUE_FIELDS = "number,title,body,labels,url,state,updatedAt";

async function gh(args: string[], cwd: string) {
  const { stdout } = await run("gh", args, { cwd, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout) as GhIssue[];
}

// Open issues assigned to you, and open issues labeled bug.
async function issues(folder: string): Promise<{ repo: string; issues: GhIssue[] }> {
  const repo = await repoOf(folder);
  const list = (extra: string[]) => gh(["issue", "list", "--repo", repo, "--state", "open", "--limit", "10", "--json", ISSUE_FIELDS, ...extra], folder).catch(() => []);
  const [mine, bugs] = await Promise.all([list(["--assignee", "@me"]), list(["--label", "bug"])]);
  return { repo, issues: [...mine, ...bugs] };
}

async function supabase(folder: string) {
  const status = (await statusOf("/supabase/status", [folder])) as Partial<SupabaseStatus>;
  return status.folders?.find((f) => f.folder === folder) ?? null;
}

// TODO/FIXME comments in tracked code, leaving out docs and lockfiles.
async function todos(folder: string) {
  const args = ["grep", "-n", "-I", "-E", "\\b(TODO|FIXME)\\b", "--", ".", ":!*.md", ":!*lock*", ":!*.min.*"];
  const { stdout } = await run("git", args, { cwd: folder, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export const FIND_DEPS = { issues, supabase, todos, report: checkProject, cards: listCards };

const quiet = async <T>(work: () => Promise<T> | T, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

async function migrationSeed(folder: string, deps: typeof FIND_DEPS): Promise<Seed[]> {
  const f = await quiet(() => deps.supabase(folder), null);
  if (!f?.link?.pending?.length) return [];
  return [{ kind: "migrations", title: migrateTitle(f), prompt: migratePrompt(f, f.link, deps.cards()) }];
}

// Every candidate seed for this folder, before dedupe and the cap.
export async function findSeeds(folder: string, deps = FIND_DEPS): Promise<Seed[]> {
  const name = path.basename(folder);
  const agentDocs = ["CLAUDE.md", "AGENTS.md"].some((f) => fs.existsSync(path.join(folder, f)));
  const [migrations, found, grep, report] = await Promise.all([
    migrationSeed(folder, deps),
    quiet(() => deps.issues(folder), null),
    quiet(() => deps.todos(folder), ""),
    quiet(() => deps.report(folder), null),
  ]);
  const todo = todoSeed(grep);
  return [
    ...(agentDocs ? [] : [agentsSeed(name)]),
    ...migrations,
    ...(found ? issueSeeds(found.repo, found.issues) : []),
    ...(report ? checkSeeds(report) : []),
    ...(todo ? [todo] : []),
  ];
}

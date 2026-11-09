import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { globalSingleton } from "./global-singleton";
import { ghError } from "./github-issues";
import { ORG_PATTERN, githubOrgMembers } from "./github-orgs";
import { githubAccount } from "./github-status";
import { REPO_PATTERN } from "./team-types";

// People to suggest for a team: the GitHub collaborators of its linked repos (and the members of its GitHub org, when
// it was made from one), through the gh CLI (no shell, repo
// checked against REPO_PATTERN first). A person's public email is looked up once and kept for EMAIL_TTL.

const run = promisify(execFile);
export const EMAIL_TTL = 10 * 60_000;
const CONCURRENCY = 4;

export type GithubPerson = { login: string; avatarUrl: string; email: string | null; repos: string[] };
export type CollaboratorsResult = { people: GithubPerson[]; error: string | null };

const emails = () => globalSingleton("__weftGithubEmails", () => new Map<string, { at: number; email: string | null }>());

// Forget the cached emails (tests).
export function clearGithubEmails() {
  emails().clear();
}

export async function repoCollaborators(repo: string): Promise<{ login: string; avatarUrl: string }[]> {
  const { stdout } = await run("gh", ["api", `repos/${repo}/collaborators`, "--paginate", "--jq", '.[] | [.login, .avatar_url] | @tsv'], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([login]) => Boolean(login))
    .map(([login, avatarUrl]) => ({ login: login as string, avatarUrl: avatarUrl ?? "" }));
}

async function publicEmail(login: string, now: number): Promise<string | null> {
  const cache = emails();
  const hit = cache.get(login);
  if (hit && now - hit.at < EMAIL_TTL) return hit.email;
  let email: string | null = null;
  try {
    const { stdout } = await run("gh", ["api", `users/${login}`, "--jq", ".email"], { timeout: 10_000 });
    const text = stdout.trim();
    email = text && text !== "null" ? text : null;
  } catch {
    email = null;
  }
  cache.set(login, { at: now, email });
  return email;
}

// A typed @login's public email, for inviting by GitHub login; null when they hide it or the login isn't one.
export async function githubEmail(login: string, now = Date.now()): Promise<string | null> {
  const name = login.trim().replace(/^@/, "");
  return ORG_PATTERN.test(name) ? publicEmail(name, now) : null;
}

// Run fn over items, at most `limit` at a time, keeping order.
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R | undefined>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out as R[];
}

// An org member who isn't on any linked repo is suggested too, with no repos.
async function addOrgMembers(org: string, me: string, byLogin: Map<string, GithubPerson>): Promise<void> {
  try {
    for (const { login, avatarUrl } of await githubOrgMembers(org)) {
      if (login.toLowerCase() === me.toLowerCase() || byLogin.has(login)) continue;
      byLogin.set(login, { login, avatarUrl, email: null, repos: [] });
    }
  } catch {
    // The repos' collaborators are enough on their own.
  }
}

export async function githubCollaborators(repos: string[], now = Date.now(), org?: string): Promise<CollaboratorsResult> {
  const valid = [...new Set(repos.filter((r) => REPO_PATTERN.test(r)))];
  if (valid.length === 0 && !org) return { people: [], error: null };
  const { account, error } = await githubAccount();
  if (!account) return { people: [], error };

  const byLogin = new Map<string, GithubPerson>();
  let failure: string | null = null;
  let failed = 0;
  await Promise.all(
    valid.map(async (repo) => {
      try {
        for (const { login, avatarUrl } of await repoCollaborators(repo)) {
          if (login.toLowerCase() === account.login.toLowerCase()) continue;
          const person = byLogin.get(login) ?? { login, avatarUrl, email: null, repos: [] };
          person.repos.push(repo);
          byLogin.set(login, person);
        }
      } catch (err) {
        failed++;
        failure ??= `${repo}: ${ghError(err, "")}`;
      }
    }),
  );
  if (org) await addOrgMembers(org, account.login, byLogin);
  const people = [...byLogin.values()];
  for (const p of people) p.repos.sort();
  people.sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
  await mapLimited(people, CONCURRENCY, async (p) => {
    p.email = await publicEmail(p.login, now);
  });
  return { people, error: valid.length > 0 && failed === valid.length ? failure : null };
}

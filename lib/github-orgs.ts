import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ghError } from "./github-issues";

// The signed-in user's GitHub orgs, for Settings → Teams' "New team" (pick one and the team takes its name and slug),
// and one org's repos and members, so its repos are suggested as projects and its members as people to invite.
// Through the gh CLI with no shell; an org login is checked against ORG_PATTERN before it reaches an argument.

const run = promisify(execFile);
const OPTS = { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 };
export const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export type GithubOrg = { login: string; avatarUrl: string };
export type GithubOrgsResult = { orgs: GithubOrg[]; error: string | null };
export type GithubOrgMember = { login: string; avatarUrl: string };

function tsvPairs(stdout: string): { login: string; avatarUrl: string }[] {
  return stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([login]) => Boolean(login))
    .map(([login, avatarUrl]) => ({ login: login as string, avatarUrl: avatarUrl ?? "" }));
}

export async function githubOrgs(): Promise<GithubOrgsResult> {
  try {
    const { stdout } = await run("gh", ["api", "user/orgs", "--paginate", "--jq", ".[] | [.login, .avatar_url] | @tsv"], OPTS);
    const orgs = tsvPairs(stdout).sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
    return { orgs, error: null };
  } catch (err) {
    return { orgs: [], error: ghError(err, "") };
  }
}

// An org's live repos as owner/name, sorted; none for a login that isn't an org name.
export async function githubOrgRepos(org: string): Promise<string[]> {
  if (!ORG_PATTERN.test(org)) return [];
  const { stdout } = await run("gh", ["api", `orgs/${org}/repos`, "--paginate", "--jq", ".[] | select(.archived | not) | .full_name"], OPTS);
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export async function githubOrgMembers(org: string): Promise<GithubOrgMember[]> {
  if (!ORG_PATTERN.test(org)) return [];
  const { stdout } = await run("gh", ["api", `orgs/${org}/members`, "--paginate", "--jq", ".[] | [.login, .avatar_url] | @tsv"], OPTS);
  return tsvPairs(stdout);
}


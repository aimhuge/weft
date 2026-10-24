// Open Source eligibility (docs/architecture/billing.md): does this GitHub user maintain an active, non-fork public
// repo with an OSI licence? Read from GitHub's REST API, with the user's own token from sign-in when we have it
// (5,000 requests an hour) and without one otherwise (60 an hour per IP, enough for a button press).

const API = "https://api.github.com";

// The bar a repo has to clear. Active: pushed to within `activeDays`. Notable: `minStars` stars, or at least
// `minRecentCommits` commits in those same days, so a busy young project counts as much as a popular old one.
export interface OssBar {
  activeDays: number;
  minStars: number;
  minRecentCommits: number;
}

export const OSS_BAR: OssBar = { activeDays: 90, minStars: 25, minRecentCommits: 20 };

// GitHub's `license.spdx_id` for the OSI-approved licences GitHub detects. NOASSERTION ("Other") doesn't count.
export const OSI_LICENCES: ReadonlySet<string> = new Set([
  "0BSD", "AFL-3.0", "AGPL-3.0", "Apache-2.0", "Artistic-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSL-1.0",
  "CECILL-2.1", "ECL-2.0", "EPL-1.0", "EPL-2.0", "EUPL-1.1", "EUPL-1.2", "GPL-2.0", "GPL-3.0", "ISC",
  "LGPL-2.1", "LGPL-3.0", "LPPL-1.3c", "MIT", "MIT-0", "MPL-2.0", "MS-PL", "MS-RL", "MulanPSL-2.0", "NCSA",
  "OSL-3.0", "PostgreSQL", "Unlicense", "UPL-1.0", "Zlib",
]);

// The fields of GitHub's repository object we read.
export interface GithubRepo {
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  pushed_at: string | null;
  license: { spdx_id: string | null } | null;
  owner: { login: string };
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
}

type Fetch = typeof fetch;

export interface OssDeps {
  token?: string | null;
  now?: Date;
  bar?: OssBar;
  fetchImpl?: Fetch;
}

// Commit counts cost one request a repo; check at most this many unstarred candidates.
const COMMIT_CHECKS = 5;

async function getJson<T>(path: string, token: string | null | undefined, fetchImpl: Fetch): Promise<T> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "weft.zip" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${API}${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

// A repo the user maintains: theirs, or one they can push to. A public list without permissions (no token) is the
// user's own repos only.
export function maintains(repo: GithubRepo, login: string): boolean {
  if (repo.owner.login.toLowerCase() === login.toLowerCase()) return true;
  const p = repo.permissions;
  return Boolean(p && (p.admin || p.maintain || p.push));
}

// Public, not a fork, not archived, OSI-licensed and pushed to within the bar's days.
export function activeOpenSource(repo: GithubRepo, now: Date, bar: OssBar = OSS_BAR): boolean {
  if (repo.private || repo.fork || repo.archived) return false;
  if (!repo.license?.spdx_id || !OSI_LICENCES.has(repo.license.spdx_id)) return false;
  const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : NaN;
  return pushed >= now.getTime() - bar.activeDays * 86_400_000;
}

// The user's public repos they maintain, most recently pushed first. With a token, org and collaborator repos too.
export async function maintainedRepos(login: string, deps: OssDeps = {}): Promise<GithubRepo[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const path = deps.token
    ? "/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100"
    : `/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`;
  const repos = await getJson<GithubRepo[]>(path, deps.token, fetchImpl);
  return repos.filter((r) => maintains(r, login));
}

// Commits on the default branch since `since`, counted up to `cap` (one page is enough to clear the bar).
export async function recentCommits(repo: GithubRepo, since: Date, cap: number, deps: OssDeps = {}): Promise<number> {
  const path = `/repos/${repo.full_name}/commits?since=${since.toISOString()}&per_page=${cap}`;
  const commits = await getJson<unknown[]>(path, deps.token, deps.fetchImpl ?? fetch);
  return commits.length;
}

// The repo that makes this user an open-source maintainer, or null when none clears the bar. Stars first, since
// they're already in the list; then commit counts on the most recently pushed few.
export async function openSourceRepo(login: string, deps: OssDeps = {}): Promise<GithubRepo | null> {
  const now = deps.now ?? new Date();
  const bar = deps.bar ?? OSS_BAR;
  const candidates = (await maintainedRepos(login, deps)).filter((r) => activeOpenSource(r, now, bar));
  const starred = candidates.find((r) => r.stargazers_count >= bar.minStars);
  if (starred) return starred;
  const since = new Date(now.getTime() - bar.activeDays * 86_400_000);
  for (const repo of candidates.slice(0, COMMIT_CHECKS)) {
    if ((await recentCommits(repo, since, bar.minRecentCommits, deps)) >= bar.minRecentCommits) return repo;
  }
  return null;
}

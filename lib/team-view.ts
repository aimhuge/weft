import type { GithubOrg } from "./github-orgs";
import type { TeamOrg } from "./team-types";

// Which workspace Settings → Team opens on: the one you last picked, kept in localStorage between opens.
export const TEAM_ORG_KEY = "weft-team-org";

export function readSavedOrg(): string | undefined {
  try {
    return window.localStorage.getItem(TEAM_ORG_KEY) || undefined;
  } catch {
    return undefined;
  }
}

// undefined forgets the pick, so the server's default workspace shows again.
export function saveOrg(slug: string | undefined): void {
  try {
    if (slug) window.localStorage.setItem(TEAM_ORG_KEY, slug);
    else window.localStorage.removeItem(TEAM_ORG_KEY);
  } catch {
    // Private mode or no storage: the pick just doesn't last.
  }
}

// A remembered slug the account no longer has (left the team, team deleted) falls back to the server default.
export function stillListed(slug: string | undefined, orgs: TeamOrg[]): boolean {
  return !slug || orgs.some((o) => o.slug === slug);
}

// The repos of the board's projects that aren't linked to the team yet, sorted.
export function unlinkedRepos(boardRepos: string[], linked: string[]): string[] {
  const have = new Set(linked.map((r) => r.toLowerCase()));
  return [...new Set(boardRepos)].filter((r) => !have.has(r.toLowerCase())).sort();
}

// How many of the board's cards sit in each repo's folder (or below it), for a team project's row. The deepest
// folder wins, so a nested project's cards aren't counted twice; archived cards don't count.
export function cardsPerRepo(
  cards: { cwd: string; archived?: boolean }[],
  folders: { folder: string; repo: string | null }[],
): Record<string, number> {
  const known = folders.filter((f): f is { folder: string; repo: string } => !!f.repo).sort((a, b) => b.folder.length - a.folder.length);
  const out: Record<string, number> = {};
  for (const c of cards) {
    if (c.archived) continue;
    const hit = known.find((f) => c.cwd === f.folder || c.cwd.startsWith(`${f.folder}/`));
    if (hit) out[hit.repo] = (out[hit.repo] ?? 0) + 1;
  }
  return out;
}

// A member as the team page names them: @login when they signed in with GitHub, else their name, else their email.
export function memberLabel(m: { login?: string | null; name: string | null; email: string | null }): string {
  if (m.login) return `@${m.login}`;
  return m.name?.trim() || m.email?.trim() || "Unnamed member";
}

// The GitHub org a team was made from: one of your own orgs whose login is the team's slug. Only your own orgs count,
// so a team that happens to share a stranger org's name never suggests that org's repos.
export function orgForTeam(slug: string, orgs: GithubOrg[]): GithubOrg | null {
  const want = slug.toLowerCase();
  return orgs.find((o) => o.login.toLowerCase() === want) ?? null;
}

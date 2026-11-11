// The desktop's people for the composer's "@" (lib/thread-transport.ts searchPeople, docs/architecture/sharing.md#mentions):
// your workspace's members (the team cache the top bar keeps warm), the card's repo collaborators, then GitHub logins.
import { loadTeam } from "./team-cache";
import { grantApi } from "./share-grant-client";
import { mergePeople } from "./share-people";
import type { PersonHit } from "./share-grant-types";
import type { TeamLoadState } from "./team-cache";

// Members who signed in with GitHub, as people; you aren't offered to yourself (the caller drops your login).
export function teamPeople(state: TeamLoadState | undefined): PersonHit[] {
  if (state?.kind !== "ok") return [];
  return state.team.members
    .filter((m): m is typeof m & { login: string } => typeof m.login === "string" && m.login !== "")
    .map((m) => ({ login: m.login, name: m.name ?? null, avatarUrl: null, kind: "team" as const }));
}

// The card's repo people, asked once per card per session (the Mac keeps them a few minutes too).
const suggested = new Map<string, Promise<PersonHit[]>>();
function repoPeople(cardId: string): Promise<PersonHit[]> {
  let hit = suggested.get(cardId);
  if (!hit) {
    // A failed ask is forgotten, so the next "@" tries again.
    hit = grantApi.people("", cardId).catch(() => {
      suggested.delete(cardId);
      return [];
    });
    suggested.set(cardId, hit);
  }
  return hit;
}

// GitHub's answers by query, kept for the session so backspacing over a login doesn't ask again.
const githubHits = new Map<string, Promise<PersonHit[]>>();
function githubPeople(q: string): Promise<PersonHit[]> {
  const key = q.toLowerCase();
  let hit = githubHits.get(key);
  if (!hit) {
    hit = grantApi.people(q).catch(() => {
      githubHits.delete(key);
      return [];
    });
    githubHits.set(key, hit);
  }
  return hit;
}

// Warm the workspace and repo people before the first "@", so the list opens with them already in hand.
export function preloadPeople(cardId: string | undefined): void {
  void loadTeam(undefined, false).catch(() => {});
  if (cardId) void repoPeople(cardId);
}

// The local people (workspace, repo) go to onLocal as soon as they're in, then GitHub's hits merge in behind them.
export async function localSearchPeople(cardId: string | undefined, query: string, onLocal?: (people: PersonHit[]) => void): Promise<PersonHit[]> {
  const q = query.trim();
  const found = q ? githubPeople(q) : Promise.resolve([]);
  const [team, repo] = await Promise.all([loadTeam(undefined, false).then(teamPeople, () => []), cardId ? repoPeople(cardId) : Promise.resolve([])]);
  const local = mergePeople(q, { team, suggested: repo });
  if (onLocal && local.length) onLocal(local);
  return mergePeople(q, { team, suggested: repo, found: await found });
}

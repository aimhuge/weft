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

export async function localSearchPeople(cardId: string | undefined, query: string): Promise<PersonHit[]> {
  const q = query.trim();
  const [team, repo, found] = await Promise.all([
    loadTeam(undefined, false).then(teamPeople, () => []),
    cardId ? repoPeople(cardId) : Promise.resolve([]),
    q ? grantApi.people(q).catch(() => []) : Promise.resolve([]),
  ]);
  return mergePeople(q, { team, suggested: repo, found });
}

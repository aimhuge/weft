// The board's calls for sharing a card with people by GitHub account (docs/architecture/sharing.md#people), beside
// lib/client-api.ts: the Share dialog's People field (components/SharePeople.tsx) and the composer's @ picker.
import { call } from "./client-api";
import type { GrantOutcome, GrantRequest, PersonHit, ShareGrantsState } from "./share-grant-types";

export const grantApi = {
  list: (cardId: string) => call<ShareGrantsState>("GET", `/api/cards/${cardId}/share/grants`),
  grant: (cardId: string, req: GrantRequest) => call<GrantOutcome[]>("POST", `/api/cards/${cardId}/share/grants`, req),
  revoke: (cardId: string, githubId: number) => call<ShareGrantsState>("DELETE", `/api/cards/${cardId}/share/grants?github=${githubId}`),
  // GitHub logins matching q; with no q, the card's repo collaborators.
  people: async (q: string, cardId?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams(q ? { q } : cardId ? { card: cardId } : {});
    return (await call<{ people: PersonHit[] }>("GET", `/api/github/users?${params}`, undefined, signal)).people;
  },
};

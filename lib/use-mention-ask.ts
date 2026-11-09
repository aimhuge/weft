"use client";

// Asking before a mention shares the thread (docs/architecture/sharing.md#mentions): on a shared card, a message that
// @mentions a GitHub user who can't open the link yet stops before it goes out and asks the owner "Give @x access?".
// Yes grants them (lib/card-share-grants.ts, via "mention", the message quoted in their email), then the message goes;
// No sends it as plain text. Nothing is granted without that answer. Desktop transport only: the grant is the Mac's.
import { useCallback, useRef, useState } from "react";
import { grantApi } from "./share-grant-client";
import { ungrantedMentions, type GrantOutcome } from "./share-grant-types";
import { loadTeam } from "./team-cache";
import { teamPeople } from "./people-search";

export interface MentionAsk {
  logins: string[];
  answer: (give: boolean) => void;
}

export interface UseMentionAsk {
  // Run before a message is sent; resolves once it may go.
  before: (text: string) => Promise<void>;
  ask: MentionAsk | null;
  // The last grant's outcomes, for the line that says who was emailed and who needs the link.
  outcomes: GrantOutcome[] | null;
  dismiss: () => void;
}

export function useMentionAsk(cardId: string, shareId: string | null | undefined, enabled: boolean): UseMentionAsk {
  const [ask, setAsk] = useState<MentionAsk | null>(null);
  const [outcomes, setOutcomes] = useState<GrantOutcome[] | null>(null);
  // Who's already in, so the same name isn't asked about twice this session.
  const granted = useRef<string[] | null>(null);

  const before = useCallback(
    async (text: string) => {
      if (!enabled || !shareId || !text.includes("@")) return;
      let fresh: string[];
      try {
        granted.current ??= (await grantApi.list(cardId)).grants.map((g) => g.login);
        const team = teamPeople(await loadTeam(undefined, false)).map((p) => p.login);
        fresh = ungrantedMentions(text, granted.current, team);
      } catch {
        return; // can't tell who's in: send as plain text rather than block the message
      }
      if (fresh.length === 0) return;
      const give = await new Promise<boolean>((resolve) => setAsk({ logins: fresh, answer: resolve }));
      setAsk(null);
      if (!give) {
        granted.current = [...granted.current, ...fresh]; // asked and declined: don't ask again this session
        return;
      }
      try {
        const out = await grantApi.grant(cardId, { logins: fresh, via: "mention", note: text });
        granted.current = [...granted.current, ...out.filter((o) => o.ok).map((o) => o.login)];
        setOutcomes(out);
      } catch (err) {
        setOutcomes(fresh.map((login) => ({ login, ok: false, error: err instanceof Error ? err.message : String(err) })));
      }
    },
    [cardId, shareId, enabled],
  );

  return { before, ask, outcomes, dismiss: () => setOutcomes(null) };
}

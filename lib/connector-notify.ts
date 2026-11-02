// Telling you when something new may act as you through a connector (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust):
// a new Mac key, a Mac key trusted, a worker vouched for, a grant turned on. Every notice goes in your ledger
// (connector_mints, outcome 'notice', which Settings → Devices reads) and, where weft.zip can send mail (RESEND_API_KEY),
// to your account's email. Best effort: a notice that can't be sent never blocks or undoes what it's about.
import "server-only";
import type { ConnectorDb } from "./connector-db";

export type Notify = (userId: string, subject: string, text: string) => Promise<void>;

const FROM = "Weft <team@weft.zip>";

// The mailer weft.zip's connector routes use: Resend's REST API, as team invites do (lib/teams.ts inviteMailer).
export function connectorMailer(db: Pick<ConnectorDb, "userEmail">, env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Notify | undefined {
  const key = env.RESEND_API_KEY;
  if (!key) return undefined;
  return async (userId, subject, text) => {
    const to = await db.userEmail(userId);
    if (!to) return;
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  };
}

const FOOTER = "\n\nIf this wasn't you, open Weft → Settings → Devices on a Mac you trust and revoke it, and sign out of Weft everywhere: someone may hold a session of yours.";

// One notice: in the ledger, and by email when there's a mailer. workerId names the worker it's about, if any.
export async function notice(deps: { db: ConnectorDb; notify?: Notify }, userId: string, o: { subject: string; text: string; workerId?: string | null }): Promise<void> {
  await deps.db
    .logMint({ user_id: userId, worker_id: o.workerId ?? null, grant_id: null, connector: "github", card_id: null, repo: null, outcome: "notice", reason: o.subject.slice(0, 300), token_kind: null, nonce: null })
    .catch(() => undefined);
  await deps.notify?.(userId, `Weft: ${o.subject}`, `${o.text}${FOOTER}`).catch(() => undefined);
}

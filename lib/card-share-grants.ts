// The Mac's side of sharing a card with people by GitHub account (docs/architecture/sharing.md#people): the Share
// dialog's People field and the composer's @ mentions list, add and remove public.cloud_share_grants rows through
// app/api/cards/[id]/share/grants, signed in as the card's owner (RLS lets only them). A login is turned into its
// numeric GitHub id here (lib/github-users.ts), then weft.zip is asked to tell the person (app/api/s/[id]/grants/notify),
// which emails them when it knows an address and answers "no-email" when it doesn't, so the dialog can say so.
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { CardShareError, shareRowFor } from "./card-share";
import { githubUserByLogin, type Gh } from "./github-users";
import { clipNote, isGithubLogin, type GrantNotice, type GrantOutcome, type GrantRequest, type ShareGrant, type ShareGrantsState } from "./share-grant-types";

type Row = { github_id: number; github_login: string; via: ShareGrant["via"]; created_at: string; notified_at: string | null; opened_at: string | null };
const COLUMNS = "github_id, github_login, via, created_at, notified_at, opened_at";
// One ask names at most this many people: a mention of a dozen is a paste, not a share.
export const GRANT_BATCH = 10;

export function toGrant(row: Row): ShareGrant {
  return { githubId: row.github_id, login: row.github_login, via: row.via, createdAt: row.created_at, notifiedAt: row.notified_at, openedAt: row.opened_at };
}

export type Notifier = (shareId: string, githubId: number, note: string | null) => Promise<GrantNotice>;

const DEFAULT_SITE = "https://weft.zip";

// Asks weft.zip to tell the person, on the owner's own access token. Anything but a clear answer is "not-sent".
export function remoteNotifier(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Notifier {
  return async (shareId, githubId, note) => {
    try {
      const { data } = await accountClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return "not-sent";
      const base = (env.WEFT_TEAMS_URL || DEFAULT_SITE).replace(/\/+$/, "");
      const res = await fetchFn(`${base}/api/s/${encodeURIComponent(shareId)}/grants/notify`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ githubId, note }),
      });
      const json = (await res.json().catch(() => null)) as { notice?: unknown } | null;
      const notice = json?.notice;
      return notice === "emailed" || notice === "no-email" ? notice : "not-sent";
    } catch {
      return "not-sent";
    }
  };
}

async function readGrants(client: SupabaseClient, shareId: string): Promise<ShareGrant[]> {
  const { data, error } = await client.from("cloud_share_grants").select(COLUMNS).eq("share_id", shareId).order("created_at");
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toGrant);
}

export async function listShareGrants(cardId: string): Promise<ShareGrantsState> {
  const r = await shareRowFor(cardId);
  if (r.kind === "blocked" || !r.shareId) return { shareId: null, grants: [] };
  return { shareId: r.shareId, grants: await readGrants(r.client, r.shareId) };
}

async function ready(cardId: string): Promise<{ client: SupabaseClient; shareId: string }> {
  const r = await shareRowFor(cardId);
  if (r.kind === "blocked" || !r.shareId) throw new CardShareError("Share this card first.", 409);
  return { client: r.client, shareId: r.shareId };
}

// The asked-for logins, cleaned: no @, no repeats (GitHub logins aren't case-sensitive), only possible ones.
export function cleanLogins(logins: unknown): string[] {
  if (!Array.isArray(logins)) return [];
  const seen = new Map<string, string>();
  for (const l of logins) {
    const name = typeof l === "string" ? l.trim().replace(/^@/, "") : "";
    if (isGithubLogin(name) && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
}

async function grantOne(client: SupabaseClient, shareId: string, login: string, req: GrantRequest, deps: { gh?: Gh; notify: Notifier }): Promise<GrantOutcome> {
  const user = await githubUserByLogin(login, deps.gh);
  if (!user) return { login, ok: false, error: `No GitHub user @${login}.` };
  // ON CONFLICT DO NOTHING: naming someone twice keeps the first grant, its via and its stamps.
  const { error } = await client
    .from("cloud_share_grants")
    .upsert({ share_id: shareId, github_id: user.id, github_login: user.login, via: req.via }, { onConflict: "share_id,github_id", ignoreDuplicates: true });
  if (error) return { login, ok: false, error: error.message };
  const { data, error: readError } = await client.from("cloud_share_grants").select(COLUMNS).eq("share_id", shareId).eq("github_id", user.id).maybeSingle<Row>();
  if (readError || !data) return { login, ok: false, error: readError?.message ?? "The grant didn't save." };
  const grant = toGrant(data);
  const notice = grant.notifiedAt ? "emailed" : await deps.notify(shareId, user.id, req.via === "mention" ? clipNote(req.note) : null);
  return { login: user.login, ok: true, grant, notice };
}

export async function grantShare(cardId: string, req: GrantRequest, deps: { gh?: Gh; notify?: Notifier } = {}): Promise<GrantOutcome[]> {
  const logins = cleanLogins(req.logins);
  if (logins.length === 0) throw new CardShareError("Name a GitHub user.", 400);
  if (logins.length > GRANT_BATCH) throw new CardShareError(`Name at most ${GRANT_BATCH} people at once.`, 400);
  const { client, shareId } = await ready(cardId);
  const notify = deps.notify ?? remoteNotifier();
  const out: GrantOutcome[] = [];
  for (const login of logins) out.push(await grantOne(client, shareId, login, req, { gh: deps.gh, notify }));
  return out;
}

export async function revokeShareGrant(cardId: string, githubId: number): Promise<ShareGrantsState> {
  if (!Number.isSafeInteger(githubId) || githubId <= 0) throw new CardShareError("Unknown person.", 400);
  const { client, shareId } = await ready(cardId);
  const { error } = await client.from("cloud_share_grants").delete().eq("share_id", shareId).eq("github_id", githubId);
  if (error) throw new Error(error.message);
  return { shareId, grants: await readGrants(client, shareId) };
}

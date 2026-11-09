// weft.zip's side of telling someone a card was shared with their GitHub account (docs/architecture/sharing.md#people),
// for POST /api/s/[id]/grants/notify, which the owner's Mac calls on its own access token right after it adds the grant
// (lib/card-share-grants.ts). The address: the weft.zip account signed in with that GitHub id (share_grant_contact), else
// the account's public GitHub email; with neither the answer is "no-email" and the dialog tells the owner to send the
// link. One email per person per share (notified_at), and at most DAILY_CAP a day per sharer, so weft.zip's sender
// can't be turned into a spam cannon by naming strangers.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { grantEmailHtml, grantEmailText, grantSubject, type GrantEmailFacts } from "./share-grant-email";
import { clipNote, isGithubLogin, type GrantNotice } from "./share-grant-types";
import { redactText } from "./share-redact";
import { SHARE_ID_RE, shareUrl } from "./share-types";
import { shareSlugPath } from "./share-access";

export const DAILY_CAP = 50;

export type SendEmail = (to: string, subject: string, text: string, html: string) => Promise<void>;
export type PublicEmail = (login: string) => Promise<string | null>;

export interface NotifyDeps {
  service: SupabaseClient;
  send: SendEmail | null;
  publicEmail: PublicEmail;
  origin: string;
  now?: () => Date;
}

export type NotifyResult = { status: number; json: { notice: GrantNotice } | { error: string } };

type GrantRow = { github_login: string; notified_at: string | null };
type ShareRow = { id: string; org_id: string; card_id: string; slug: string | null; created_by: string };

// Resend, as team invites send (lib/teams.ts inviteMailer).
export function resendSender(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): SendEmail | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  return async (to, subject, text, html) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Weft <team@weft.zip>", to: [to], subject, text, html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  };
}

// The address a GitHub account shows publicly, or null (hidden, no such user, rate-limited). GITHUB_LOOKUP_TOKEN, when
// set, lifts the anonymous 60-an-hour limit Vercel's shared addresses run into.
export function githubPublicEmail(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): PublicEmail {
  return async (login) => {
    if (!isGithubLogin(login)) return null;
    try {
      const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "weft.zip" };
      if (env.GITHUB_LOOKUP_TOKEN) headers.authorization = `Bearer ${env.GITHUB_LOOKUP_TOKEN}`;
      const res = await fetchFn(`https://api.github.com/users/${login}`, { headers });
      if (!res.ok) return null;
      const email = ((await res.json()) as { email?: unknown }).email;
      return typeof email === "string" && email.includes("@") ? email : null;
    } catch {
      return null;
    }
  };
}

async function sharerFacts(service: SupabaseClient, userId: string): Promise<{ name: string; login: string | null }> {
  try {
    const { data } = await service.auth.admin.getUserById(userId);
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const login = typeof meta.user_name === "string" && isGithubLogin(meta.user_name) ? meta.user_name : null;
    const name = [meta.full_name, meta.name, login].find((v): v is string => typeof v === "string" && v.trim() !== "");
    return { name: name ?? "Someone", login };
  } catch {
    return { name: "Someone", login: null };
  }
}

async function cardFacts(service: SupabaseClient, share: ShareRow): Promise<{ title: string; emoji: string | null }> {
  const { data } = await service.from("cloud_cards").select("card").eq("org_id", share.org_id).eq("card_id", share.card_id).maybeSingle<{ card: { title?: unknown; emoji?: unknown } | null }>();
  const title = typeof data?.card?.title === "string" && data.card.title.trim() ? data.card.title.trim().slice(0, 120) : "A Weft thread";
  const emoji = typeof data?.card?.emoji === "string" && data.card.emoji.length <= 8 ? data.card.emoji : null;
  return { title: redactText(title), emoji };
}

async function overCap(service: SupabaseClient, userId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { count } = await service.from("cloud_share_grants").select("share_id", { count: "exact", head: true }).eq("granted_by", userId).gte("notified_at", since);
  return (count ?? 0) >= DAILY_CAP;
}

function parseBody(shareId: string, body: unknown): { githubId: number; note: unknown } | null {
  const { githubId, note } = (body ?? {}) as { githubId?: unknown; note?: unknown };
  if (!SHARE_ID_RE.test(shareId) || typeof githubId !== "number" || !Number.isSafeInteger(githubId) || githubId <= 0) return null;
  return { githubId, note };
}

// The weft.zip account's address for that GitHub id, else the account's public GitHub email.
async function contactFor(deps: NotifyDeps, githubId: number, login: string): Promise<string | null> {
  const { data } = (await deps.service.rpc("share_grant_contact", { github: githubId })) as { data: unknown };
  if (typeof data === "string" && data) return data;
  return deps.publicEmail(login);
}

async function emailFacts(service: SupabaseClient, origin: string, userId: string, share: ShareRow, login: string, note: unknown): Promise<GrantEmailFacts> {
  const [sharer, card, path] = await Promise.all([sharerFacts(service, userId), cardFacts(service, share), shareSlugPath(service, share)]);
  const clipped = clipNote(note);
  return {
    sharer: sharer.name,
    sharerLogin: sharer.login,
    login,
    title: card.title,
    emoji: card.emoji,
    note: clipped ? redactText(clipped) : null,
    url: path ? `${origin}${path}` : shareUrl(share.id, origin),
  };
}

const notice = (n: GrantNotice): NotifyResult => ({ status: 200, json: { notice: n } });

export async function notifyGrant(deps: NotifyDeps, userId: string, shareId: string, body: unknown): Promise<NotifyResult> {
  const parsed = parseBody(shareId, body);
  if (!parsed) return { status: 400, json: { error: "Send { githubId, note? }." } };
  const { service } = deps;
  // Only the person who added the grant may have it announced.
  const { data: grant } = await service
    .from("cloud_share_grants")
    .select("github_login, notified_at")
    .eq("share_id", shareId)
    .eq("github_id", parsed.githubId)
    .eq("granted_by", userId)
    .maybeSingle<GrantRow>();
  if (!grant) return { status: 404, json: { error: "No such grant." } };
  if (grant.notified_at) return notice("emailed");
  const to = await contactFor(deps, parsed.githubId, grant.github_login);
  if (!to) return notice("no-email");
  const now = deps.now?.() ?? new Date();
  if (!deps.send || (await overCap(service, userId, now))) return notice("not-sent");
  const { data: share } = await service.from("cloud_shares").select("id, org_id, card_id, slug, created_by").eq("id", shareId).maybeSingle<ShareRow>();
  if (!share) return { status: 404, json: { error: "No such share." } };
  const facts = await emailFacts(service, deps.origin, userId, share, grant.github_login, parsed.note);
  try {
    await deps.send(to, grantSubject(facts), grantEmailText(facts), grantEmailHtml(facts));
  } catch (err) {
    console.error(`share-grant-notify: ${err instanceof Error ? err.message : String(err)}`);
    return notice("not-sent");
  }
  await service.from("cloud_share_grants").update({ notified_at: now.toISOString() }).eq("share_id", shareId).eq("github_id", parsed.githubId);
  return notice("emailed");
}

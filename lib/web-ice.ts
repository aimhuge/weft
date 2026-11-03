// The ICE servers for weft.zip's session lines (app/api/web-board/ice): the desktop's own TURN minting (lib/rtc-ice.ts),
// behind the web side's gate instead of the desktop's launch token. A TURN allocation is billed relay traffic, so it goes
// only to a signed-in visitor who owns a live (unrevoked) worker, the only one who can open a line at all
// (private.owns_device), and at most WEB_ICE_PER_MINUTE times a minute per account. The Cloudflare key stays on the
// server; the browser gets the short-lived username and credential Cloudflare minted (TURN_TTL_S), nothing more.
import "server-only";
import type { IceServer } from "@weft/client";
import { fixedWindow } from "./fixed-window";
import { mintIce } from "./rtc-ice";

// A line asks once as it opens and again after a drop; a tab reconnecting through a flaky network stays well under it.
export const WEB_ICE_PER_MINUTE = 12;
const windows = fixedWindow(60_000);

export type WebIceAnswer =
  | { status: 200; body: { iceServers: IceServer[]; turn: boolean } }
  | { status: 401 | 403; body: { error: string } }
  | { status: 429; body: { error: string }; retryAfter: number };

// Reads as the visitor: cloud_workers' RLS shows a member every worker in their workspaces, so the owner filter matters.
type Db = { from(table: "cloud_workers"): { select(cols: "id"): OwnerQuery } };
type OwnerQuery = { eq(col: "owner_user", id: string): { is(col: "revoked_at", v: null): { limit(n: 1): PromiseLike<{ data: unknown[] | null; error: unknown }> } } };

export async function ownsWorker(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db.from("cloud_workers").select("id").eq("owner_user", userId).is("revoked_at", null).limit(1);
  return !error && Boolean(data?.length);
}

export async function webIce(
  session: { supabase: unknown; user: { id: string } | null },
  now: number = Date.now(),
  mint: () => Promise<{ iceServers: IceServer[]; turn: boolean }> = () => mintIce(),
): Promise<WebIceAnswer> {
  const { user } = session;
  if (!user) return { status: 401, body: { error: "Sign in first." } };
  if (windows.hit(user.id, now) > WEB_ICE_PER_MINUTE) return { status: 429, body: { error: "Too many requests." }, retryAfter: windows.retryAfter(user.id, now) };
  if (!(await ownsWorker(session.supabase as Db, user.id))) return { status: 403, body: { error: "Only a worker's owner opens a line to it." } };
  return { status: 200, body: await mint() };
}

// Tests start each case from empty windows.
export const resetWebIceLimits = () => windows.reset();

// The share link's access gate (lib/share-types.ts): one row in cloud_shares + its cloud_cards row,
// checked against the visitor's cookie pass, the workspace membership, and the row's mode. The viewer
// and the live poll both go through shareAccess so an unauthorized request gets the same 4xx shape
// the page renders.
//
// `loadShare` reads both rows through the service client (RLS would deny the unauthenticated visitor
// anyway). `shareAccess` is the verdict the page and the API turn into a status. The unconfigured
// cases come first so a Weft without a service key never reveals a share's existence.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasGatePass, type ShareGateKit } from "@aimhuge/share/server";
import { isCardShareMode, type CloudShareRow, SHARE_ID_RE } from "./share-types";
import { serviceClient, webUser } from "./web-session";
import { getShareGate } from "./share-gate";

export interface LoadedShare {
  share: CloudShareRow;
  // The card the share points at, joined through cloud_cards. Absent when the card has been deleted
  // (a share keeps its id) or the row hasn't reached Supabase yet.
  card: { card_id: string; card: unknown; deleted: boolean; updated_at: string } | null;
}

// The page's verdict, in 5 cases. The page's `ok` branch builds the ShareLive; the others render
// straight to a page (`missing` → notFound, `denied`/`login`/`gate`/`unconfigured` → their own UI).
export type ShareAccess =
  | { kind: "ok"; share: LoadedShare }
  | { kind: "gate"; mode: "email" | "password" }
  | { kind: "login" }
  | { kind: "denied" }
  | { kind: "missing" }
  | { kind: "unconfigured" };

// Read the share row + its card through the service client. SHARE_ID_RE is checked first so a
// request for an obviously-wrong id fails fast and never reaches Supabase; ids that match but don't
// exist return `null` so the page can 404.
export async function loadShare(id: string): Promise<LoadedShare | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const service = serviceClient();
  if (!service) return null;
  const { data: share, error: shareError } = await service
    .from("cloud_shares")
    .select("*")
    .eq("id", id)
    .maybeSingle<CloudShareRow>();
  if (shareError) return null;
  if (!share) return null;
  const { data: card, error: cardError } = await service
    .from("cloud_cards")
    .select("card_id, card, deleted, updated_at")
    .eq("org_id", share.org_id)
    .eq("card_id", share.card_id)
    .maybeSingle<{ card_id: string; card: unknown; deleted: boolean; updated_at: string }>();
  // A missing card row means the card has been deleted (the share is a tombstone) or hasn't reached
  // Supabase yet. Either way, the viewer can't show it.
  if (cardError) return null;
  if (!card || card.deleted) return { share, card: null };
  return { share, card };
}

// The share id behind weft.zip/@<username>/threads/<slug> (lib/share-types.ts threadPublicUrl), or null. The
// page then runs the same gate as /s/<id>, so a slug only ever names a link, never opens it.
export async function shareIdBySlug(service: SupabaseClient, username: string, slug: string): Promise<string | null> {
  const { data: profile } = await service.from("profiles").select("id").eq("username", username).maybeSingle<{ id: string }>();
  if (!profile) return null;
  const { data } = await service
    .from("cloud_shares")
    .select("id")
    .eq("created_by", profile.id)
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

// The address a slugged share lives at, for /s/<id>'s redirect: null when it has no slug or its sharer no username.
export async function shareSlugPath(service: SupabaseClient, share: Pick<CloudShareRow, "slug" | "created_by">): Promise<string | null> {
  if (!share.slug || !share.created_by) return null;
  const { data } = await service.from("profiles").select("username").eq("id", share.created_by).maybeSingle<{ username: string | null }>();
  return data?.username ? `/@${data.username}/threads/${share.slug}` : null;
}

// The gate's verdict on any share row, a card's (cloud_shares) or a mini app's (cloud_app_shares, lib/app-share-access.ts):
// the row's mode, the workspace membership for private, the pass cookie for the gated modes.
export type GateVerdict = Exclude<ShareAccess, { kind: "ok" } | { kind: "missing" }> | { kind: "ok" };

// `id` is the link's id, the one the pass cookie was granted for.
export async function gateVerdict(
  id: string,
  share: { org_id: string; mode: string },
  opts: { gate?: ShareGateKit; hasPass?: boolean } = {},
): Promise<GateVerdict> {
  const mode = share.mode;
  // An unknown mode (an old row from before the package renamed something, a row tampered with) is
  // treated like the strictest private mode: refuse, never render. Fail closed.
  if (!isCardShareMode(mode)) return { kind: "denied" };
  if (mode === "public") return { kind: "ok" };
  if (mode === "private") return memberVerdict(share.org_id);
  // The gated modes: a valid pass short-circuits to ok; otherwise the gate form.
  const gate = opts.gate ?? getShareGate();
  const hasPass = opts.hasPass ?? (await hasGatePass(gate, id));
  if (hasPass) return { kind: "ok" };
  return { kind: "gate", mode };
}

// The verdict, parameterized so the unlock route can hand in the pass cookie state instead of
// re-reading next/headers (a Server Component is read-only). The page and the live route take the
// no-arg form.
export async function shareAccessFor(
  id: string,
  opts: { gate?: ShareGateKit; hasPass?: boolean } = {},
): Promise<ShareAccess> {
  const loaded = await loadShare(id);
  if (!loaded) return { kind: "unconfigured" };
  if (!loaded.card) return { kind: "missing" };
  const verdict = await gateVerdict(id, loaded.share, opts);
  return verdict.kind === "ok" ? { kind: "ok", share: loaded } : verdict;
}

async function memberVerdict(orgId: string): Promise<GateVerdict> {
  const service = serviceClient();
  if (!service) return { kind: "unconfigured" };
  const user = await webUser();
  if (!user) return { kind: "login" };
  // A private share is open to every member of the share's workspace. org_memberships is gated by
  // RLS, but the service client bypasses it — the membership row is the only check.
  const { data: membership } = await service
    .from("org_memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (!membership) return { kind: "denied" };
  return { kind: "ok" };
}

// The simple form, used by the page and the live poll. Re-uses shareAccessFor with no pass override
// so each route re-checks the gate on every request.
export async function shareAccess(id: string): Promise<ShareAccess> {
  return shareAccessFor(id);
}

// What insertCloudShareVisit inserts, used by the unlock route after a valid email.
export interface CloudShareVisitInput {
  shareId: string;
  email: string | null;
}

// Used by the unlock route to log "X got through the email gate" and "X opened a public link".
// `service` is the service client (RLS denies INSERT to non-service roles).
export async function insertShareVisit(
  service: SupabaseClient,
  input: CloudShareVisitInput,
): Promise<void> {
  const { error } = await service
    .from("cloud_share_visits")
    .insert({ share_id: input.shareId, email: input.email });
  // A duplicate (the same email visited the same share twice) is fine; any other error is logged
  // but not fatal — the gate pass was granted, the visitor moves on.
  if (error && !/duplicate key|unique constraint/i.test(error.message)) {
    console.error(`share-access: visit insert failed: ${error.message}`);
  }
}

// The Mac's side of the plan gate on shared mini apps (docs/architecture/mini-app-hosting.md "Access, plans and
// limits"): a workspace's open links may serve up to its plan's bytes (APP_SHARE_BYTES in lib/billing/plans.ts).
// The database is the gate (supabase/migrations/20261024124411_app_share_quota.sql: a trigger weighs each row from
// its blobs and refuses one over the cap); this reads the same numbers through app_share_quota() so the Share
// dialog can show the room left, refuses before uploading anything that wouldn't fit, and turns the trigger's
// refusal into the dialog's wording.
import fs from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppShareQuota } from "./app-share-types";
import { bytesLabel, catalog, type PlanId } from "./billing/plans";

// The workspace's plan, the bytes its open links use (leaving exceptShare out) and the cap; null when the
// database can't say (signed out of it, an older database without the function): the trigger still decides.
export async function readQuota(client: SupabaseClient, orgId: string, exceptShare: string | null = null): Promise<AppShareQuota | null> {
  try {
    const { data, error } = (await client.rpc("app_share_quota", { org: orgId, except_share: exceptShare })) as {
      data: unknown;
      error: unknown;
    };
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as { plan?: unknown; used?: unknown; cap?: unknown } | undefined;
    if (!row || typeof row.plan !== "string") return null;
    const used = Number(row.used);
    const cap = Number(row.cap);
    if (!Number.isFinite(used) || !Number.isFinite(cap)) return null;
    const plan = catalog.get(row.plan).id;
    return { plan, planName: catalog.get(plan).name, used, cap };
  } catch {
    return null;
  }
}

// What a link's page weighs on this Mac: the one file of a single page, every file of a folder, nothing for a site.
export function pageBytes(page: { kind: "blob"; local: string } | { kind: "site" } | { kind: "folder"; files: { size: number }[] }): number {
  if (page.kind === "site") return 0;
  if (page.kind === "folder") return page.files.reduce((sum, f) => sum + f.size, 0);
  try {
    return fs.statSync(page.local).size;
  } catch {
    return 0;
  }
}

// The plan with more room, or null on the plan with the most.
function roomier(plan: PlanId): string | null {
  if (plan === "team") return null;
  return plan === "free" ? "Pro" : "Team";
}

// "This app is 31 MB, and Free's shared apps have 25 MB, 12 MB of it in use. Make another app's link private, or move
// to Pro for 1 GB."
export function overMessage(plan: string, used: number, cap: number, bytes: number): string {
  const id = catalog.get(plan).id;
  const name = catalog.get(id).name;
  const head = `This app is ${bytesLabel(bytes)}, and the ${name} plan's shared apps have ${bytesLabel(cap)}, ${bytesLabel(used)} of it in use.`;
  const next = roomier(id);
  const tail = next
    ? ` Make another app's link private, or move to ${next} for more room.`
    : " Make another app's link private to free room.";
  return head + tail;
}

// Why a write would go over, or null when it fits: a private link always fits, and so does a quota we couldn't read
// (the database decides then).
export function quotaRefusal(quota: AppShareQuota | null, mode: string, bytes: number): string | null {
  if (!quota || mode === "private" || bytes === 0) return null;
  return quota.used + bytes > quota.cap ? overMessage(quota.plan, quota.used, quota.cap, bytes) : null;
}

const TRIGGER_RE = /app_share_quota: (\d+) of (\d+) bytes on the (\w+) plan/;

// The trigger's refusal ("app_share_quota: 31457280 of 26214400 bytes on the free plan") as the dialog's wording,
// or null for any other error. The trigger only knows the total, so the message says the total.
export function quotaErrorText(message: string, bytes: number): string | null {
  const m = TRIGGER_RE.exec(message);
  if (!m) return null;
  const total = Number(m[1]);
  return overMessage(m[3] as string, Math.max(0, total - bytes), Number(m[2]), bytes);
}

// Whether this app's page, at the size it is on this Mac, fits the workspace's room as the link `shareId` (left
// out of `used`, so its old size doesn't count twice) in `mode`: null when it fits, else why not.
export async function roomFor(
  client: SupabaseClient,
  orgId: string,
  shareId: string | null,
  mode: string,
  page: Parameters<typeof pageBytes>[0],
): Promise<string | null> {
  if (mode === "private") return null;
  const bytes = pageBytes(page);
  if (bytes === 0) return null;
  return quotaRefusal(await readQuota(client, orgId, shareId), mode, bytes);
}

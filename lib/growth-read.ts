import { serviceClient } from "./web-session";

// Growth events to post to Slack (docs/architecture/slack.md): the new users, new teams and payments that
// happened since the last time we looked.
//
// The rows live in production Supabase, and the Slack bot token lives on the Mac — so the read happens here,
// on the Mac, with the service key, and only the message goes to Slack. The deployed Weft has no bot token,
// which is why this is not a route but a library.
//
// The read is public.growth_events(since), a service-role function (supabase/migrations/20261026043000_growth_events.sql).

export interface GrowthUser {
  kind: "user";
  id: string;
  email: string | null;
  at: string;
}

export interface GrowthTeam {
  kind: "team";
  id: string;
  name: string;
  slug: string;
  members: number;
  at: string;
}

export interface GrowthPayment {
  kind: "payment";
  id: string;
  event: string;
  org: string;
  slug: string;
  actor: string | null;
  plan: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  seats: number | null;
  at: string;
}

export type GrowthEvent = GrowthUser | GrowthTeam | GrowthPayment;

// How far back to look when there is no watermark yet: a week, so the first run posts the recent past once.
export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60_000;

// The events since a time. An empty list when the read fails — a Slack channel with no growth is better than a
// Weft that throws every minute.
export async function growthEvents(
  since: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<GrowthEvent[]> {
  const service = serviceClient(env);
  if (!service) return [];
  const answer = await service.rpc("growth_events", { since: since.toISOString() });
  if (answer.error || !Array.isArray(answer.data)) return [];
  return (answer.data as unknown[]).filter(isGrowthEvent);
}

// The shape the function returns, checked before it is trusted: one unknown field would otherwise reach Slack.
function isGrowthEvent(value: unknown): value is GrowthEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.at !== "string" || typeof row.kind !== "string") return false;
  if (row.kind === "user") return typeof row.id === "string";
  if (row.kind === "team") return typeof row.id === "string" && typeof row.name === "string";
  if (row.kind === "payment") return typeof row.id === "string" && typeof row.org === "string";
  return false;
}

// The headline numbers for the daily summary: the same overview the 📈 Growth app shows.
export interface GrowthOverview {
  accounts: number;
  new_7d: number;
  new_30d: number;
  signed_in_7d: number;
  signed_in_30d: number;
  never_signed_in: number;
  workspaces: number;
  invites_pending: number;
  syncing_accounts: number;
  synced_cards: number;
  paying_workspaces: number;
}

export async function growthOverview(env: Record<string, string | undefined> = process.env): Promise<GrowthOverview | null> {
  const service = serviceClient(env);
  if (!service) return null;
  const answer = await service.rpc("growth_overview");
  if (answer.error || !answer.data || typeof answer.data !== "object") return null;
  const row = answer.data as unknown as Record<string, unknown>;
  const num = (key: keyof GrowthOverview) => {
    const value = row[key];
    return typeof value === "number" ? value : 0;
  };
  return {
    accounts: num("accounts"),
    new_7d: num("new_7d"),
    new_30d: num("new_30d"),
    signed_in_7d: num("signed_in_7d"),
    signed_in_30d: num("signed_in_30d"),
    never_signed_in: num("never_signed_in"),
    workspaces: num("workspaces"),
    invites_pending: num("invites_pending"),
    syncing_accounts: num("syncing_accounts"),
    synced_cards: num("synced_cards"),
    paying_workspaces: num("paying_workspaces"),
  };
}

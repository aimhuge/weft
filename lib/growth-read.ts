import { shell } from "./browser-shell";
import { serviceClient } from "./web-session";

// Growth events to post to Slack (docs/architecture/slack.md): the new users, new teams and payments that
// happened since the last time we looked.
//
// The rows live in production Supabase, and the Slack bot token lives on the Mac — so the read happens here,
// on the Mac, with the service key, and only the message goes to Slack. The deployed Weft has no bot token,
// which is why this is not a route but a library.
//
// The read is public.growth_events(since), a service-role function (supabase/migrations/20261026043000_growth_events.sql).
//
// Where the key comes from. The service key lives in the 🔐 vault, and in the packaged app it never reaches
// this server: the server inherits Electron's environment, which holds no vault value. So the read has two
// paths: the key in the environment (a deployed Weft, or a dev server started with the vault's values), or
// Electron main, which opens the vault and reads the numbers with the key there (electron/growth-read.cjs).
// The key never comes back either way — only rows.

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
  const rows = await growthRows("growth_events", { since: since.toISOString() }, env);
  if (!Array.isArray(rows)) return [];
  return rows.filter(isGrowthEvent);
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

/**
 * Why the numbers could not be read: no service key, the read failed, or nothing came back.
 *
 * The three causes need three different fixes, and a summary that fails silently sends people looking in the
 * wrong place — a missing channel looks like a missing key looks like Slack refusing the message.
 */
export type GrowthReadFailure = "no_service_key" | "read_failed" | "empty_answer";

export interface GrowthOverviewResult {
  overview: GrowthOverview | null;
  failure: GrowthReadFailure | null;
  /** Where the numbers came from: the environment's key, or Electron main's vault. */
  source: "environment" | "electron" | null;
}

export async function growthOverview(env: Record<string, string | undefined> = process.env): Promise<GrowthOverview | null> {
  return (await growthOverviewResult(env)).overview;
}

/** The numbers, and why there are none when there are none. */
export async function growthOverviewResult(env: Record<string, string | undefined> = process.env): Promise<GrowthOverviewResult> {
  const service = serviceClient(env);
  // With no key in the environment, the read belongs to Electron main, which opens the vault (electron/growth-read.cjs).
  if (!service) {
    const rows = await growthRowsInMain("growth_overview", {}, env);
    if (!rows) {
      console.warn("[weft] growth: no SUPABASE_SECRET_KEY in the environment and Electron main couldn't read the vault");
      return { overview: null, failure: "no_service_key", source: null };
    }
    return { overview: overviewFrom(rows), failure: null, source: "electron" };
  }
  const answer = await service.rpc("growth_overview");
  if (answer.error) {
    console.warn(`[weft] growth: growth_overview failed: ${answer.error.message}`);
    return { overview: null, failure: "read_failed", source: "environment" };
  }
  if (!answer.data || typeof answer.data !== "object") {
    console.warn("[weft] growth: growth_overview answered with nothing");
    return { overview: null, failure: "empty_answer", source: "environment" };
  }
  return { failure: null, overview: overviewFrom(answer.data), source: "environment" };
}

// The overview's numbers, read off one row: a number where there is one, zero where there isn't.
function overviewFrom(row: unknown): GrowthOverview {
  const source = (row ?? {}) as Record<string, unknown>;
  const num = (key: keyof GrowthOverview) => {
    const value = source[key];
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

// The rows for a growth function: from the environment's key when there is one, else from Electron main.
async function growthRows(
  fn: "growth_overview" | "growth_events",
  args: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<unknown> {
  const service = serviceClient(env);
  if (!service) return growthRowsInMain(fn, args, env);
  const answer = await service.rpc(fn, args);
  if (answer.error || !Array.isArray(answer.data)) return [];
  return answer.data;
}

// The same rows, read by Electron main with the vault's key. Null when main isn't there to ask: without the
// desktop app there is no vault to open and no key to open it with.
async function growthRowsInMain(
  fn: "growth_overview" | "growth_events",
  args: Record<string, string>,
  env: Record<string, string | undefined>,
): Promise<unknown> {
  try {
    const answer = await shell("/growth/read", { fn, args, environment: env.WEFT_GROWTH_ENV || "production" });
    return answer.rows;
  } catch (err) {
    console.warn(`[weft] growth: Electron main couldn't read ${fn}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

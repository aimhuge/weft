// Weft's plan catalog (docs/architecture/billing.md): Free, Open Source, Education, Pro and Team, and their per-meter allowances.
// Client-safe: a board-side plan picker can import the catalog and the prices without pulling in Supabase or Stripe.

import { defineCatalog, type BasePlan } from "@aimhuge/billing";

export type PlanId = "free" | "oss" | "edu" | "pro" | "team";

export interface Plan extends BasePlan<PlanId> {
  // A short marketing line for the plan picker; not used by billing math.
  blurb: string;
  // The BlastCP tier this plan includes.
  blastcp: BlastcpTier;
}

// A BlastCP tier as Weft's pricing sells it. The numbers mirror BlastCP's own catalog (aimhuge/blastcp,
// src/lib/billing/plans.ts), so keep them in step with it. BlastCP enforces them, not Weft, and nothing
// links a Weft subscription to a BlastCP workspace yet (docs/architecture/billing.md).
export interface BlastcpTier {
  name: string;
  brands: number;
  // null is every channel and unlimited posts, as in BlastCP's catalog; not zero.
  channels: number | null;
  postsPerMonth: number | null;
  // Dollars of BlastCP's AI audio, video, image and text generation. Free's is spent once, never refilled.
  creditDollars: number;
  creditResets: boolean;
}

export const BLASTCP_FREE: BlastcpTier = {
  name: "BlastCP Free",
  brands: 1,
  channels: 3,
  postsPerMonth: 30,
  creditDollars: 0.5,
  creditResets: false,
};

// Open Source, Education, Pro and Team carry Creator: BlastCP Pro is $29 flat, more than a one-seat Team's $9.
export const BLASTCP_CREATOR: BlastcpTier = {
  name: "BlastCP Creator",
  brands: 1,
  channels: null,
  postsPerMonth: null,
  creditDollars: 3,
  creditResets: true,
};

// The free tier: the plans with no Puku allowance of their own, which run on the Puku trial's daily cap
// (lib/puku-proxy.ts): Free, Open Source and Education. A free plan never gets more Puku than this cap
// (docs/architecture/billing.md). PUKU_TRIAL_DAILY_REQUESTS / PUKU_TRIAL_DAILY_TOKENS on the deployment override it.
export interface FreeTier {
  name: string;
  plans: readonly PlanId[];
  dailyRequests: number;
  // Input + output tokens per user per day; cache reads don't count.
  dailyTokens: number;
}

export const FREE_TIER: FreeTier = {
  name: "Free tier",
  plans: ["free", "oss", "edu"],
  dailyRequests: 150,
  dailyTokens: 1_000_000,
};

// "1M tokens a day", for the plan rows and pricing that quote the cap.
export function freeTierCapLabel(tier: FreeTier = FREE_TIER) {
  const m = tier.dailyTokens / 1_000_000;
  return m >= 1 ? `${m}M tokens a day` : `${tier.dailyTokens / 1000}K tokens a day`;
}

// Regional Pro (docs/architecture/billing.md): still plan "pro" with Pro's allowance, at a lower monthly price in
// World Bank low-income and lower-middle-income countries (lib/billing/regional.ts picks which).
export const REGIONAL_PRO_CENTS = { low: 500, lowerMiddle: 1000 } as const;

// Startups (docs/architecture/billing.md): still plan "team" at TEAM_SEAT_CENTS, taken to $0 for freeMonths and
// then half price for halfPriceMonths by Stripe subscription-schedule phases, on up to maxSeats seats, for companies
// under maxRaisedUsd raised and under maxAgeYears old.
export const STARTUP_TEAM = {
  freeMonths: 6,
  halfPriceMonths: 6,
  maxSeats: 10,
  maxRaisedUsd: 5_000_000,
  maxAgeYears: 3,
} as const;

// Shared mini apps (docs/architecture/mini-app-hosting.md "Access, plans and limits"): views are unlimited on every
// plan, and so is the number of links; what a plan caps is the bytes a workspace's open links serve, together. A
// private link doesn't count, and a site link (an https address) stores nothing. Open Source and Education follow
// Pro. The database enforces the same numbers (supabase/migrations/20261024124411_app_share_quota.sql
// app_share_byte_limit); lib/app-share-quota.test.ts keeps the two in step.
const MB = 1024 * 1024;
export const APP_SHARE_BYTES: Record<PlanId, number> = {
  free: 25 * MB,
  oss: 1024 * MB,
  edu: 1024 * MB,
  pro: 1024 * MB,
  team: 5 * 1024 * MB,
};

// "25 MB" / "1 GB": a byte count the way the plan rows and the Share dialog say it.
export function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * MB) return `${+(bytes / (1024 * MB)).toFixed(1)} GB`;
  if (bytes >= MB) return `${+(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(0, Math.ceil(bytes / 1024))} KB`;
}

// "1 GB of shared mini apps, views unlimited", for a plan row.
export function appShareLabel(plan: string): string {
  return `${bytesLabel(APP_SHARE_BYTES[catalog.get(plan).id])} of shared mini apps, views unlimited`;
}

// The usage ledger's meters. Tokens count input + output, the same way lib/puku-proxy.ts already does it
// (cache writes are part of input, cache reads don't count).
export const PUKU_METER = "puku_tokens";

// Pro's monthly Puku allowance, in tokens. A placeholder the user will tune — match this in Stripe prices,
// and the number `org_usage_total` caps with, if you add one.
export const PRO_PUKU_TOKENS = 300_000_000;

// Team adds Pro's allowance, and is the plan that may have members: workspaces invite and manage people on
// Pro and Team, and a Free workspace stays a team of one (docs/architecture/teams.md). Per-seat, like
// @aimhuge/billing's DeckCP catalog — the price is per seat per month, so a workspace pays for its people.
export const TEAM_SEAT_CENTS = 900;

export const catalog = defineCatalog<PlanId, Plan>({
  plans: {
    free: {
      id: "free",
      name: "Free",
      blurb: "The whole app, on the free tier's daily Puku cap.",
      monthlyUnitAmountCents: 0,
      perSeat: false,
      blastcp: BLASTCP_FREE,
    },
    oss: {
      id: "oss",
      name: "Open Source",
      blurb: "Free for maintainers of an active open-source project: teams and BlastCP Creator on the free tier.",
      monthlyUnitAmountCents: 0,
      perSeat: false,
      blastcp: BLASTCP_CREATOR,
    },
    edu: {
      id: "edu",
      name: "Education",
      blurb: "Free for students and teachers through the GitHub Student Developer Pack, a class workspace included.",
      monthlyUnitAmountCents: 0,
      perSeat: false,
      blastcp: BLASTCP_CREATOR,
    },
    pro: {
      id: "pro",
      name: "Pro",
      blurb: "Weft's full Puku allowance, refreshed every billing period.",
      monthlyUnitAmountCents: 2000,
      perSeat: false,
      allowances: { [PUKU_METER]: { amount: PRO_PUKU_TOKENS } },
      blastcp: BLASTCP_CREATOR,
    },
    team: {
      id: "team",
      name: "Team",
      blurb: "Pro's allowance for a whole team: invites, roles and a shared workspace.",
      monthlyUnitAmountCents: TEAM_SEAT_CENTS,
      perSeat: true,
      allowances: { [PUKU_METER]: { amount: PRO_PUKU_TOKENS } },
      blastcp: BLASTCP_CREATOR,
    },
  },
  // Cheapest first: defines what counts as an upgrade and the catalog's display order. Open Source and Education
  // cost nothing, so they sit with Free; neither has a Puku allowance (FREE_TIER above).
  order: ["free", "oss", "edu", "pro", "team"],
  free: "free",
  // "Two months free" on a yearly Pro term.
  yearlyMonthsCharged: 10,
});

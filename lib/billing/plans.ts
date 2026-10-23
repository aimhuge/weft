// Weft's plan catalog (docs/architecture/billing.md): the Free and Pro plans and their per-meter allowances.
// Client-safe: a board-side plan picker can import the catalog and the prices without pulling in Supabase or Stripe.

import { defineCatalog, type BasePlan } from "@aimhuge/billing";

export type PlanId = "free" | "pro" | "team";

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

// Pro and Team both carry Creator: BlastCP Pro is $29 flat, more than a one-seat Team's $9.
export const BLASTCP_CREATOR: BlastcpTier = {
  name: "BlastCP Creator",
  brands: 1,
  channels: null,
  postsPerMonth: null,
  creditDollars: 3,
  creditResets: true,
};

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
      blurb: "The whole app, with today's Puku trial's daily cap.",
      monthlyUnitAmountCents: 0,
      perSeat: false,
      blastcp: BLASTCP_FREE,
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
  // Cheapest first: defines what counts as an upgrade and the catalog's display order.
  order: ["free", "pro", "team"],
  free: "free",
  // "Two months free" on a yearly Pro term.
  yearlyMonthsCharged: 10,
});

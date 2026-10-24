// Why the upgrade dialog opened, and the words it opens with (docs/architecture/billing.md "The upgrade dialog").
// Client-safe: the board, weft.zip's team page and the server's gates all import it, so a gate's refusal and the
// dialog it opens can't drift apart.

import { APP_SHARE_BYTES, bytesLabel } from "./plans";

// What the user hit: a paywall (teams, room for shared apps, the free Puku cap) or just the Upgrade button.
export type UpgradeReason = "teams" | "share-room" | "puku-cap" | "plan";

// The paid plans the dialog sells, and how often they bill.
export type UpgradePlan = "pro" | "team";
export type UpgradeInterval = "monthly" | "yearly";

// What a checkout start answers: a Stripe Checkout URL to open, a change that already applied, or a refusal.
export type CheckoutAnswer = { ok: true; url: string } | { ok: true; applied: true } | { ok: false; error: string };

// What a Free workspace is told when it tries to bring someone in. It names Pro, not Team: Pro already carries the
// seats, so it is the cheaper way to unlock this, and the wording does not tell a Pro subscriber to buy a bigger plan.
export const TEAM_GATE_MESSAGE = "Teams are part of Pro. Upgrade this workspace to invite members — or to Team, at $9 a seat.";

// The start of the Puku proxy's free-cap refusal (lib/puku-proxy.ts), as a card shows it in its error.
const PUKU_CAP_TEXT = "today's free Puku trial";

export const UPGRADE_COPY: Record<UpgradeReason, { title: string; sub: string }> = {
  teams: { title: "Invite your team with Pro", sub: "A Free workspace is a team of one. Pro or Team lets you bring people in." },
  "share-room": { title: "More room for shared apps", sub: `Your shared mini apps are out of room. Pro has ${bytesLabel(APP_SHARE_BYTES.pro)}, Team ${bytesLabel(APP_SHARE_BYTES.team)}.` },
  "puku-cap": { title: "Keep going with Pro", sub: "You've used today's free Puku tokens. Pro gives your workspace a monthly allowance." },
  plan: { title: "Upgrade Weft", sub: "Pick a plan for this workspace. Checkout is on Stripe; cancel any time." },
};

// The reason a team action's refusal carries: its `upgrade` field from a current weft.zip, or the gate's own words
// from a deployment that predates the field.
export function upgradeReasonOf(result: { ok: boolean; message?: string; upgrade?: UpgradeReason }): UpgradeReason | null {
  if (result.ok) return null;
  if (result.upgrade) return result.upgrade;
  return result.message === TEAM_GATE_MESSAGE ? "teams" : null;
}

// Whether a card's error is the free Puku cap, which an upgrade lifts.
export function isPukuCapError(error: string | null | undefined): boolean {
  return !!error && error.includes(PUKU_CAP_TEXT);
}

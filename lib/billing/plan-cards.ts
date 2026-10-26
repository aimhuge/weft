import { APP_SHARE_BYTES, bytesLabel, catalog, freeTierCapLabel, PRO_PUKU_TOKENS, type PlanId } from "./plans";
import type { UpgradeInterval } from "./upgrade";

// The three plans as the upgrade dialog shows them (components/UpgradeDialog.tsx). Client-safe, and every number is
// read from the catalog in lib/billing/plans.ts, so a price change there moves the dialog too.

export interface PlanCard {
  id: "free" | "pro" | "team";
  name: string;
  // "$20", "$200", "$9", "$0".
  price: string;
  // "/month", "/year", "per seat / month", "forever".
  cadence: string;
  // A line under the price: "2 months free", "billed on your seats".
  note: string | null;
  features: string[];
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US")}`;
}

function shareRoom(id: PlanId): string {
  return `${bytesLabel(APP_SHARE_BYTES[id])} of shared mini apps`;
}

const PUKU = `${(PRO_PUKU_TOKENS / 1_000_000).toLocaleString("en-US")}M Puku tokens a month`;

// Team only has a monthly per-seat price, so its card reads the same on either interval.
export function planCards(interval: UpgradeInterval): PlanCard[] {
  const yearly = interval === "yearly";
  const pro = catalog.get("pro");
  const team = catalog.get("team");
  return [
    {
      id: "free",
      name: catalog.get("free").name,
      price: "$0",
      cadence: "forever",
      note: null,
      features: ["The whole app on your Mac", `Puku on the free tier: ${freeTierCapLabel()}`, "A workspace of one", shareRoom("free")],
    },
    {
      id: "pro",
      name: pro.name,
      price: dollars(yearly ? catalog.totalCents("pro", "yearly", 1) : catalog.priceCents("pro", "monthly")),
      cadence: yearly ? "/year" : "/month",
      note: yearly ? `Save ${dollars(catalog.yearlySavingsCents("pro"))} a year` : null,
      features: [PUKU, "Invite your team", shareRoom("pro")],
    },
    {
      id: "team",
      name: team.name,
      price: dollars(catalog.priceCents("team", "monthly")),
      cadence: "per seat / month",
      note: yearly ? "Billed monthly on your seats" : "Billed on your seats",
      features: ["Pro's allowance for the team", "Roles, invites, a shared board", shareRoom("team")],
    },
  ];
}

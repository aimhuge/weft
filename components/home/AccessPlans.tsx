import { freeTierCapLabel, REGIONAL_PRO_CENTS, STARTUP_TEAM } from "@/lib/billing/plans";

// The row under the three plans: Startups, Open Source, Education and Regional pricing (docs/architecture/billing.md,
// "Planned"). Each is a way into Free, Pro or Team rather than a plan of its own, so they're smaller than the plan
// cards and marked Coming soon until weft.zip can grant or sell them. Numbers are read from the catalog.

interface AccessCard {
  id: string;
  name: string;
  headline: string;
  body: string;
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

// Only what billing delivers: the grant's BlastCP tier stays off until BlastCP applies it (docs/architecture/billing.md).
const FREE_PERKS = `teams, free, on the free tier's ${freeTierCapLabel()} of Puku`;

// 6 → "six months", 12 → "a year"; anything else as digits.
const months = (n: number) => (n === 6 ? "six months" : n === 12 ? "a year" : `${n} months`);

// 5_000_000 → "$5M".
const millions = (usd: number) => `$${usd / 1_000_000}M`;

const STARTUP_BODY =
  `Raised under ${millions(STARTUP_TEAM.maxRaisedUsd)} and founded in the last ${STARTUP_TEAM.maxAgeYears} years? ` +
  `Up to ${STARTUP_TEAM.maxSeats} seats of Team, Pro's allowance on each, free for ${months(STARTUP_TEAM.freeMonths)} ` +
  `and half price for ${months(STARTUP_TEAM.halfPriceMonths)} more. Apply, or come through your accelerator.`;

export const ACCESS_CARDS: AccessCard[] = [
  {
    id: "startup",
    name: "Startups",
    headline: `Team free for ${months(STARTUP_TEAM.freeMonths)}`,
    body: STARTUP_BODY,
  },
  {
    id: "oss",
    name: "Open source",
    headline: "Free for maintainers",
    body: `Maintain an active open-source project? Get ${FREE_PERKS}. We check your GitHub when you sign in.`,
  },
  {
    id: "edu",
    name: "Education",
    headline: "Free for students and teachers",
    body: `Through the GitHub Student Developer Pack: ${FREE_PERKS}. Teachers get a workspace for their class.`,
  },
  {
    id: "regional",
    name: "Regional pricing",
    headline: `Pro from ${dollars(REGIONAL_PRO_CENTS.low)}`,
    body: `Pro's full allowance for ${dollars(REGIONAL_PRO_CENTS.low)} a month in low-income countries and ${dollars(REGIONAL_PRO_CENTS.lowerMiddle)} in lower-middle-income ones.`,
  },
];

export default function AccessPlans() {
  return (
    <div id="wz-access" className="wz-accessGrid">
      {ACCESS_CARDS.map((c) => (
        <article key={c.id} className="wz-access">
          <p className="wz-accessName">
            {c.name}
            <span className="wz-accessSoon">Coming soon</span>
          </p>
          <p className="wz-accessHeadline">{c.headline}</p>
          <p className="wz-accessBody">{c.body}</p>
        </article>
      ))}
    </div>
  );
}

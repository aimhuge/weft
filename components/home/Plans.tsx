import { catalog, PRO_PUKU_TOKENS, TEAM_SEAT_CENTS, type PlanId } from "@/lib/billing/plans";

// The pricing section under the pillars (docs/architecture/billing.md). The three plans come from the catalog
// in lib/billing/plans.ts, so a price change there moves this page too — the numbers below are read, not typed.
// A server component with no client JS, like the rest of the home page.

interface PlanCard {
  id: string;
  name: string;
  blurb: string;
  price: string;
  cadence: string;
  features: string[];
  featured: boolean;
}

// "300,000,000" is not a price anyone reads. The allowance in millions, which is how the billing page and
// the docs talk about it.
function pukuAllowanceLabel(): string {
  return `${(PRO_PUKU_TOKENS / 1_000_000).toLocaleString("en-US")}M Puku tokens a month`;
}

// A plan's headline price: "$20", "$9" per seat. Free reads as "Free" rather than "$0".
function priceFor(id: PlanId): { price: string; cadence: string } {
  const plan = catalog.get(id);
  if (id === "free") return { price: "Free", cadence: "forever" };
  const cents = catalog.priceCents(id, "monthly");
  const price = `$${(cents / 100).toLocaleString("en-US")}`;
  return { price, cadence: plan.perSeat ? "per seat / month" : "/month" };
}

function cardFor(id: PlanId, features: string[], featured: boolean): PlanCard {
  const plan = catalog.get(id);
  const { price, cadence } = priceFor(id);
  return { id: plan.id, name: plan.name, blurb: plan.blurb, price, cadence, features, featured };
}

const CARDS: PlanCard[] = [
  cardFor(
    "free",
    [
      "The whole app on your Mac",
      "Puku threads on today's daily trial",
      "A workspace of one, all to yourself",
    ],
    false,
  ),
  cardFor(
    "pro",
    [
      `${pukuAllowanceLabel()}, refreshed every billing period`,
      "$20 a month, or $200 a year",
      "Invite your team into the workspace",
      "Everything in Free",
    ],
    true,
  ),
  cardFor(
    "team",
    [
      `$${(TEAM_SEAT_CENTS / 100).toLocaleString("en-US")} per seat a month, billed on your seats`,
      "Pro's allowance, shared across the workspace",
      "Roles, invites and a shared board",
      "Everything in Pro",
    ],
    false,
  ),
];

export default function Plans() {
  return (
    <section className="wz-wrap wz-plans" aria-labelledby="wz-plansTitle">
      <h2 id="wz-plansTitle" className="wz-h2">
        A plan for <em>every loom.</em>
      </h2>
      <div className="wz-planGrid">
        {CARDS.map((c) => (
          <article key={c.id} className={`wz-plan${c.featured ? " wz-planFeatured" : ""}`}>
            <p className="wz-planName">{c.name}</p>
            <p className="wz-planPrice">
              <span className="wz-planAmount">{c.price}</span>
              <span className="wz-planCadence">{c.cadence}</span>
            </p>
            <p className="wz-planBlurb">{c.blurb}</p>
            <ul className="wz-planFeatures">
              {c.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="wz-planNote">
        Weft is free to download and open source. Plans are per workspace, charged on weft.zip, and cancel any time.
      </p>
    </section>
  );
}
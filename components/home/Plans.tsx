import { catalog, freeTierCapLabel, PRO_PUKU_TOKENS, TEAM_SEAT_CENTS, type BlastcpTier, type PlanId } from "@/lib/billing/plans";
import { planLink } from "@/lib/billing/plan-link";
import AccessPlans from "./AccessPlans";

// The pricing section under the pillars (docs/architecture/billing.md). The three plans come from the catalog
// in lib/billing/plans.ts, so a price change there moves this page too — the numbers below are read, not typed.
// Each card ends in its way in: Free downloads the app, Pro and Team go through /billing to the upgrade dialog and
// Stripe Checkout (lib/billing/plan-link.ts). A server component with no client JS, like the rest of the home page.
//
// Each card also lists the BlastCP tier its plan includes (plan.blastcp), which BlastCP applies to the person's own
// BlastCP workspace: Team's to every seat, Pro's to the workspace owner (lib/billing/blastcp-bundle.ts,
// docs/architecture/billing.md "BlastCP usage").

export interface PlanCta {
  label: string;
  href: string;
}

interface PlanCard {
  id: string;
  name: string;
  blurb: string;
  price: string;
  cadence: string;
  features: string[];
  featured: boolean;
  cta: PlanCta | null;
}

// "300,000,000" is not a price anyone reads. The allowance in millions, which is how the billing page and
// the docs talk about it.
function pukuAllowanceLabel(): string {
  return `${(PRO_PUKU_TOKENS / 1_000_000).toLocaleString("en-US")}M Puku tokens a month`;
}

// Who on a plan gets its BlastCP tier, as blastcpBundle (lib/billing/blastcp-bundle.ts) decides it.
const BLASTCP_WHO: Partial<Record<PlanId, string>> = { pro: " for the owner", team: " for every seat" };

// The BlastCP tier a plan includes, as two bullets: what it posts, and its generation credit.
// "BlastCP Free: 1 brand, 3 channels, 30 posts a month" / "$3 a month of BlastCP AI generation".
function blastcpLines(id: PlanId, tier: BlastcpTier): string[] {
  const brands = `${tier.brands} brand${tier.brands === 1 ? "" : "s"}`;
  const channels = tier.channels === null ? "every channel" : `${tier.channels} channels`;
  const posts = tier.postsPerMonth === null ? "unlimited posts" : `${tier.postsPerMonth} posts a month`;
  const credit = `$${tier.creditDollars.toFixed(2).replace(/\.00$/, "")}`;
  const generation = tier.creditResets
    ? `${credit} a month of BlastCP AI generation`
    : `${credit} of BlastCP AI generation, once`;
  return [`${tier.name}${BLASTCP_WHO[id] ?? ""}: ${brands}, ${channels}, ${posts}`, generation];
}

// A plan's headline price: "$20", "$9" per seat. Free reads as "Free" rather than "$0".
function priceFor(id: PlanId): { price: string; cadence: string } {
  const plan = catalog.get(id);
  if (id === "free") return { price: "Free", cadence: "forever" };
  const cents = catalog.priceCents(id, "monthly");
  const price = `$${(cents / 100).toLocaleString("en-US")}`;
  return { price, cadence: plan.perSeat ? "per seat / month" : "/month" };
}

function cardFor(id: PlanId, features: string[], featured: boolean, cta: PlanCta | null): PlanCard {
  const plan = catalog.get(id);
  const { price, cadence } = priceFor(id);
  // The BlastCP bullets go after the plan's own, before its closing "Everything in …".
  const last = features.at(-1)?.startsWith("Everything in") ? features.length - 1 : features.length;
  const all = [...features.slice(0, last), ...blastcpLines(id, plan.blastcp), ...features.slice(last)];
  return { id: plan.id, name: plan.name, blurb: plan.blurb, price, cadence, features: all, featured, cta };
}

// The three cards; Free's button is the page's download, which the home page passes in (null leaves it off).
function cards(download: PlanCta | null): PlanCard[] {
  return [
    cardFor(
      "free",
      [
        "The whole app on your Mac",
        `Puku threads on the free tier: ${freeTierCapLabel()}`,
        "A workspace of one, all to yourself",
      ],
      false,
      download,
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
      { label: "Get Pro", href: planLink("pro") },
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
      { label: "Get Team", href: planLink("team") },
    ),
  ];
}

export default function Plans({ download = null }: { download?: PlanCta | null }) {
  return (
    <section className="wz-wrap wz-plans" aria-labelledby="wz-plansTitle">
      <h2 id="wz-plansTitle" className="wz-h2">
        A plan for <em>every loom.</em>
      </h2>
      <div className="wz-planGrid">
        {cards(download).map((c) => (
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
            {c.cta ? (
              <a className={`wz-planCta${c.featured ? " wz-planCtaFeatured" : ""}`} href={c.cta.href} data-track="plan_clicked" data-track-plan={c.id}>
                {c.cta.label}
              </a>
            ) : null}
          </article>
        ))}
      </div>
      <AccessPlans />
      <p className="wz-planNote">
        Weft is free to download and open source. Plans are per workspace, charged on weft.zip, and cancel any time.
      </p>
    </section>
  );
}
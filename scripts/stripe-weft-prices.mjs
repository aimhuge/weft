// Creates Weft's products and recurring prices on the shared AimHuge Stripe account, the way BlastCP's are made
// (metadata app/plan/interval, a lookup key per price), and prints the STRIPE_PRICE_* ids Weft's billing reads
// (docs/architecture/billing.md "Environment"). Idempotent: a price whose lookup key already exists is reused, never
// duplicated. Run it through the vault: mcp__secrets__run("node scripts/stripe-weft-prices.mjs", ["STRIPE_SECRET_KEY"]).
//
// The amounts must match the catalog in lib/billing/plans.ts (Pro $20/month or $200/year, Team $9 per seat a month or $90 a year,
// REGIONAL_PRO_CENTS $5 and $10): nothing reconciles them, so change both together.

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY isn't set.");
  process.exit(1);
}

const PRODUCTS = {
  pro: { name: "Weft Pro", description: "Weft's full Puku allowance, refreshed every billing period, and teams." },
  team: { name: "Weft Team", description: "Pro's allowance for a whole team: invites, roles and a shared workspace. Billed per seat." },
};

const PRICES = [
  { env: "STRIPE_PRICE_PRO_MONTHLY", plan: "pro", interval: "month", cents: 2000 },
  { env: "STRIPE_PRICE_PRO_YEARLY", plan: "pro", interval: "year", cents: 20000 },
  { env: "STRIPE_PRICE_TEAM_MONTHLY", plan: "team", interval: "month", cents: 900 },
  // Checkout only bills Team monthly (lib/billing/checkout.ts), but @aimhuge/billing refuses to start any checkout
  // without a price for every paid plan × interval, so the catalog's yearly seat ($9 × yearlyMonthsCharged) exists too.
  { env: "STRIPE_PRICE_TEAM_YEARLY", plan: "team", interval: "year", cents: 9000 },
  { env: "STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOW", plan: "pro", interval: "month", cents: 500, variant: "regional_low" },
  { env: "STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOWER_MIDDLE", plan: "pro", interval: "month", cents: 1000, variant: "regional_lower_middle" },
];

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body && { "content-type": "application/x-www-form-urlencoded" }) },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe answered ${res.status}`);
  return json;
}

// "weft_pro_monthly_2000", "weft_pro_monthly_regional_low_500": BlastCP's shape, with the variant before the amount.
function lookupKey(p) {
  const interval = p.interval === "month" ? "monthly" : "yearly";
  return ["weft", p.plan, interval, p.variant, String(p.cents)].filter(Boolean).join("_");
}

// The active product for a plan, found by its metadata, or made.
const productIds = {};
async function productFor(plan) {
  if (productIds[plan]) return productIds[plan];
  const found = await stripe("GET", `products/search?query=${encodeURIComponent(`active:'true' AND metadata['app']:'weft' AND metadata['plan']:'${plan}'`)}`);
  const product =
    found.data[0] ??
    (await stripe("POST", "products", { ...PRODUCTS[plan], "metadata[app]": "weft", "metadata[plan]": plan }));
  if (!found.data[0]) console.error(`created product ${product.id} ${product.name}`);
  productIds[plan] = product.id;
  return product.id;
}

const keys = PRICES.map(lookupKey);
const existing = await stripe("GET", `prices?active=true&limit=100&${keys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join("&")}`);
for (const p of PRICES) {
  const lookup = lookupKey(p);
  let price = existing.data.find((x) => x.lookup_key === lookup);
  if (price) {
    if (price.unit_amount !== p.cents || price.recurring?.interval !== p.interval) {
      throw new Error(`${lookup} exists as ${price.id} with a different amount or interval; fix it by hand.`);
    }
  } else {
    const interval = p.interval === "month" ? "monthly" : "yearly";
    price = await stripe("POST", "prices", {
      product: await productFor(p.plan),
      currency: "usd",
      unit_amount: String(p.cents),
      "recurring[interval]": p.interval,
      lookup_key: lookup,
      nickname: `Weft ${p.plan === "pro" ? "Pro" : "Team"} ${interval}${p.variant ? ` (${p.variant})` : ""}`,
      "metadata[app]": "weft",
      "metadata[plan]": p.plan,
      "metadata[interval]": interval,
      ...(p.variant && { "metadata[variant]": p.variant }),
    });
    console.error(`created price ${price.id} ${lookup}`);
  }
  console.log(`${p.env}=${price.id}`);
}

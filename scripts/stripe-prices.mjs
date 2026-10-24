// Lists the Stripe account's active products, their recurring prices and its webhook endpoints, so the STRIPE_PRICE_* ids Weft's billing
// needs can be read off (docs/architecture/billing.md "Environment"). Run it through the vault, which puts
// STRIPE_SECRET_KEY in its env: mcp__secrets__run("node scripts/stripe-prices.mjs", ["STRIPE_SECRET_KEY"]).
// Prints ids, names, amounts and intervals only; never the key.

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY isn't set.");
  process.exit(1);
}

async function list(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${key}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe answered ${res.status}`);
  return body.data;
}

console.log(`mode: ${key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test"}`);
const products = await list("products?active=true&limit=100");
const prices = await list("prices?active=true&limit=100");
for (const product of products) {
  console.log(`\n${product.id}  ${product.name}  ${JSON.stringify(product.metadata)}`);
  for (const price of prices.filter((p) => p.product === product.id)) {
    const amount = price.unit_amount === null ? "custom" : `${(price.unit_amount / 100).toFixed(2)} ${price.currency}`;
    const every = price.recurring ? `/${price.recurring.interval_count > 1 ? price.recurring.interval_count : ""}${price.recurring.interval}` : " once";
    console.log(`  ${price.id}  ${amount}${every}  ${price.billing_scheme}  lookup=${price.lookup_key ?? "-"}  ${JSON.stringify(price.metadata)}`);
  }
}

// The webhook endpoints, so a missing weft.zip/api/billing/webhook shows up before billing is switched on.
console.log("\nwebhooks:");
for (const hook of await list("webhook_endpoints?limit=100")) {
  console.log(`  ${hook.id}  ${hook.status}  ${hook.url}  ${hook.enabled_events.join(",")}`);
}

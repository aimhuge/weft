// Opens a throwaway Stripe Checkout session for Pro monthly with Weft's checkoutBranding and prints its URL, so the
// branding can be seen before a deploy (docs/architecture/billing.md). Nothing is charged unless someone pays it; the
// session expires on its own. Run it through the vault with a test key:
// mcp__secrets__run("node scripts/stripe-checkout-preview.mjs", ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]).
//
// BRANDING mirrors checkoutBranding in lib/billing/billing.ts; change both together.

const key = process.env.STRIPE_SECRET_KEY;
const price = process.env.STRIPE_PRICE_PRO_MONTHLY;
if (!key || !price) {
  console.error("STRIPE_SECRET_KEY and STRIPE_PRICE_PRO_MONTHLY must be set.");
  process.exit(1);
}

const BRANDING = {
  "branding_settings[display_name]": "Weft",
  "branding_settings[icon][type]": "url",
  "branding_settings[icon][url]": "https://weft.zip/app-icon.png",
  "branding_settings[button_color]": "#da7a4c",
};

const params = new URLSearchParams({
  mode: "subscription",
  "line_items[0][price]": price,
  "line_items[0][quantity]": "1",
  success_url: "https://weft.zip/checkout/done",
  cancel_url: "https://weft.zip",
  ...BRANDING,
});

const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2026-07-29.dahlia" },
  body: params.toString(),
});
const json = await res.json();
if (!res.ok) {
  console.error(json.error?.message ?? `Stripe answered ${res.status}`);
  process.exit(1);
}
console.log(`${key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "LIVE" : "test"} ${json.url}`);

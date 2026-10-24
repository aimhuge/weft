// Registers https://weft.zip/api/billing/webhook on the shared AimHuge Stripe account with the nine events Weft's
// billing handles (docs/architecture/billing.md "Setup steps"), and hands the new endpoint's signing secret straight
// to Vercel production as STRIPE_WEBHOOK_SECRET, over the Vercel CLI's stdin. The secret is never printed: Stripe shows
// it only once, at creation, and it must not reach a transcript. If Vercel refuses it, the endpoint is deleted again so
// a re-run starts clean. Run it through the vault from the project folder (the linked Vercel project):
// mcp__secrets__run("node scripts/stripe-weft-webhook.mjs", ["STRIPE_SECRET_KEY"], production).

import { spawnSync } from "node:child_process";

const URL = "https://weft.zip/api/billing/webhook";
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.updated",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_method.attached",
  "payment_method.detached",
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY isn't set.");
  process.exit(1);
}

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

const existing = (await stripe("GET", "webhook_endpoints?limit=100")).data.find((h) => h.url === URL);
if (existing) {
  console.log(`${URL} is already registered as ${existing.id} (${existing.status}). Its secret can't be read again; roll it in the Stripe dashboard if Vercel's copy is wrong.`);
  process.exit(0);
}

const params = { url: URL, description: "Weft billing (weft.zip)", "metadata[app]": "weft" };
EVENTS.forEach((event, i) => (params[`enabled_events[${i}]`] = event));
const hook = await stripe("POST", "webhook_endpoints", params);
console.log(`created ${hook.id} ${hook.url} with ${hook.enabled_events.length} events`);

const push = spawnSync("vercel", ["env", "add", "STRIPE_WEBHOOK_SECRET", "production", "--force", "--sensitive", "--yes"], {
  input: hook.secret,
  encoding: "utf8",
});
// Vercel's own output, with the secret scrubbed in case it is ever echoed.
const scrub = (text) => (text ?? "").split(hook.secret).join("‹STRIPE_WEBHOOK_SECRET›").trim();
if (push.status !== 0) {
  console.error(`vercel env add failed (${push.status}): ${scrub(push.stderr) || scrub(push.stdout)}`);
  await stripe("DELETE", `webhook_endpoints/${hook.id}`);
  console.error(`deleted ${hook.id} again, so a re-run starts clean`);
  process.exit(1);
}
console.log("STRIPE_WEBHOOK_SECRET set on Vercel production (takes effect on the next deploy)");

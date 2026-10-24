// Replays Stripe events to the local Weft's /api/billing/webhook, signed with STRIPE_WEBHOOK_SECRET, for when
// `stripe listen` missed them or the local server rejected them. Prints each event's HTTP status, never the secret.
// mcp__secrets__run("node scripts/stripe-replay-local.mjs evt_1 evt_2 …", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]).
import { createHmac } from "node:crypto";

const key = process.env.STRIPE_SECRET_KEY;
const secret = process.env.STRIPE_WEBHOOK_SECRET;
const target = process.env.WEFT_WEBHOOK_TARGET || "http://127.0.0.1:1024/api/billing/webhook";
if (!key || !secret) {
  console.error("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set.");
  process.exit(1);
}

for (const id of process.argv.slice(2)) {
  const res = await fetch(`https://api.stripe.com/v1/events/${id}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.log(`${id} fetch failed ${res.status}`);
    continue;
  }
  const body = await res.text();
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const out = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` }, body });
  console.log(`${id} ${JSON.parse(body).type} -> ${out.status} ${(await out.text()).slice(0, 120)}`);
}

// Says which Stripe CLI profile's `stripe listen` signing secret matches STRIPE_WEBHOOK_SECRET, printing only
// "match" or "no match" per profile, never a secret. mcp__secrets__run("node scripts/stripe-listen-secret-check.mjs", ["STRIPE_WEBHOOK_SECRET"]).
import { spawnSync } from "node:child_process";

const want = process.env.STRIPE_WEBHOOK_SECRET;
if (!want) {
  console.error("STRIPE_WEBHOOK_SECRET isn't set.");
  process.exit(1);
}
for (const profile of ["default", "weft"]) {
  const args = ["listen", "--print-secret", ...(profile === "default" ? [] : ["--project-name", profile])];
  const out = spawnSync("stripe", args, { encoding: "utf8" });
  const got = (out.stdout ?? "").trim();
  console.log(`${profile}: ${got ? (got === want ? "match" : "no match") : "no secret (not logged in?)"}`);
}

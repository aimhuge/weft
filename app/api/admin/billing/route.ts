// The admin console's workspace list (docs/architecture/billing.md "Admin console"): orgs matching ?q= by slug or name,
// each with its plan, plus which Stripe modes this Weft holds a key for. Super-admin only (lib/billing/admin/route-gate.ts).
import { adminAnswer, adminGate } from "@/lib/billing/admin/route-gate";
import { listOrgs } from "@/lib/billing/admin/snapshot";

export async function GET(req: Request) {
  const gate = await adminGate(req, false);
  if (gate instanceof Response) return gate;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return adminAnswer(async () => ({ orgs: await listOrgs(gate.service, q), keys: gate.stripe.modes(), defaultMode: gate.stripe.defaultMode() }));
}

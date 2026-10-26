import { fetchBillingStatus } from "@/lib/billing-client";
import { notePlan } from "@/lib/blastcp-plan";
import { fail, guard } from "@/lib/guard";

// The board's read-only view of the signed-in user's billing (docs/architecture/billing.md). Forwards to the
// deployed Weft; null means signed out (the section hides itself), { error } is a short message the section
// shows, and the BillingStatus JSON is what the row renders.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    const status = await fetchBillingStatus();
    // A new plan (Checkout just finished, say) nudges BlastCP to apply the tier it includes.
    notePlan(status && "plan" in status ? status.plan.id : null);
    return Response.json(status);
  } catch (err) {
    return fail(err);
  }
}

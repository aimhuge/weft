// One workspace in the admin console (docs/architecture/billing.md "Admin console"). GET is its whole billing picture,
// with the Stripe mode its ids live in; POST `{ op, ...input }` runs one change (lib/billing/admin/dispatch.ts): plan
// changes, cancel, refunds, reset, people, coupons. Super-admin only (lib/billing/admin/route-gate.ts).
import { runOrgOp } from "@/lib/billing/admin/dispatch";
import { adminAnswer, adminGate } from "@/lib/billing/admin/route-gate";
import { orgDetail } from "@/lib/billing/admin/snapshot";

type Ctx = { params: Promise<{ orgId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const gate = await adminGate(req, false);
  if (gate instanceof Response) return gate;
  const { orgId } = await params;
  return adminAnswer(() => orgDetail({ ...gate, orgId }));
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await adminGate(req, true);
  if (gate instanceof Response) return gate;
  const { orgId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return adminAnswer(() => runOrgOp({ ...gate, orgId }, body));
}

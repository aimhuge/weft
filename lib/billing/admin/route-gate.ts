import "server-only";

// The front door every admin billing route goes through (docs/architecture/billing.md "Admin console"): the localhost
// guard, the super-admin gate (lib/admin.ts, a 4xx for everyone else before anything is read), the service client and
// the Stripe clients per mode. `adminAnswer` turns an op's result or error into the JSON reply.

import { adminServiceClient, requireSuperAdminWeft } from "@/lib/admin";
import { fail, guard } from "@/lib/guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminStripe, AdminBillingError, type AdminStripe } from "./stripe-keys";

export interface AdminGate {
  service: SupabaseClient;
  actorEmail: string;
  stripe: AdminStripe;
}

export async function adminGate(req: Request, write: boolean): Promise<AdminGate | Response> {
  const denied = guard(req, { write });
  if (denied) return denied;
  try {
    const { email } = await requireSuperAdminWeft();
    const service = await adminServiceClient();
    if (!service) return Response.json({ error: "SUPABASE_SECRET_KEY is not set, so the billing tables can't be read." }, { status: 503 });
    return { service: service, actorEmail: email, stripe: adminStripe() };
  } catch (err) {
    return fail(err);
  }
}

// Our own refusals and Stripe's answers (an admin may read them verbatim) are 400s; anything else is a 500.
export function adminError(err: unknown): Response {
  const type = (err as { type?: unknown } | null)?.type;
  const stripeError = typeof type === "string" && type.startsWith("Stripe");
  if (err instanceof AdminBillingError || stripeError) return fail(err, 400);
  console.error(`Admin billing: ${err instanceof Error ? err.message : String(err)}`);
  return fail(err, 500);
}

export async function adminAnswer(work: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (err) {
    return adminError(err);
  }
}

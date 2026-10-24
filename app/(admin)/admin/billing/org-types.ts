// The shape of GET /api/admin/billing/[orgId] (lib/billing/admin/snapshot.ts orgDetail), as the panel reads it.

export interface OrgDetail {
  org: { id: string; slug: string; name: string };
  row: {
    plan: string;
    status: string;
    billing_interval: string;
    seats: number;
    unit_amount_cents: number;
    current_period_end: string;
    cancel_at_period_end: boolean;
    trial_end: string | null;
    provider: string;
    provider_customer_id: string | null;
    provider_subscription_id: string | null;
  } | null;
  mode: { mode: "live" | "test" | "unknown" | "none"; deleted: boolean; checked: string[]; detail: string | null };
  keys: string[];
  defaultMode: string | null;
  members: { userId: string; email: string | null; name: string | null; role: string; joinedAt: string }[];
  invoices: { number: string; status: string; total_cents: number; amount_paid_cents: number; issued_at: string; provider: string }[];
  events: { kind: string; actor_email: string | null; payload: Record<string, unknown>; created_at: string }[];
  charges: { id: string; amountCents: number; refundedCents: number; refundableCents: number; currency: string; status: string; description: string | null; createdAt: string; receiptUrl: string | null }[];
  referral: { code: string; promotion_codes: Record<string, string> } | null;
  errors: string[];
}

// Run one op on the workspace: `confirm` is asked first when given; the panel reloads after.
export type RunOp = (op: string, payload?: Record<string, unknown>, confirm?: string) => Promise<unknown>;

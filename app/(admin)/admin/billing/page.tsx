// /admin/billing — the super-admin's billing console (docs/architecture/billing.md "Admin console"): find a workspace,
// see which Stripe mode its ids live in, and change its plan, seats, people, discounts, refunds or reset it.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins; every route behind it gates again.
import type { Metadata } from "next";
import { requireSuperAdminWeft } from "@/lib/admin";
import BillingAdmin from "./BillingAdmin";

export const metadata: Metadata = { title: "Weft admin — Billing" };

export default async function AdminBillingPage() {
  await requireSuperAdminWeft();
  return <BillingAdmin />;
}

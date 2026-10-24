// /admin/billing — the super-admin's billing console (docs/architecture/billing.md "Admin console"): find a workspace,
// see which Stripe mode its ids live in, and change its plan, seats, people, discounts, refunds or reset it.
// Gate: `requireSuperAdminWeft()` throws notFound() for non-admins; every route behind it gates again.
import type { Metadata } from "next";
import AdminGate from "../AdminGate";
import BillingAdmin from "./BillingAdmin";

export const metadata: Metadata = { title: "Weft admin — Billing" };

export default function AdminBillingPage() {
  return (
    <AdminGate>
      <BillingAdmin />
    </AdminGate>
  );
}

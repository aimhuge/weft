// /admin/coupons — coupon codes and referrals (docs/architecture/billing.md "Coupons and referrals"): make and turn off
// Stripe promotion codes per mode, and pay or void referral rewards. Gate: `requireSuperAdminWeft()` (404 for others).
import type { Metadata } from "next";
import { requireSuperAdminWeft } from "@/lib/admin";
import CouponsAdmin from "./CouponsAdmin";

export const metadata: Metadata = { title: "Weft admin — Coupons" };

export default async function AdminCouponsPage() {
  await requireSuperAdminWeft();
  return <CouponsAdmin />;
}

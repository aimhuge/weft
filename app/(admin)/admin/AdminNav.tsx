"use client";

// The admin bar's tabs: Users, Billing, Coupons, Settings, with the current page's tab lit.

import Link from "next/link";
import { usePathname } from "next/navigation";

export const ADMIN_TABS: Array<{ href: string; label: string; title: string }> = [
  { href: "/admin/users", label: "Users", title: "Every weft.zip account" },
  { href: "/admin/billing", label: "Billing", title: "Workspace plans, refunds and resets" },
  { href: "/admin/coupons", label: "Coupons", title: "Coupon codes and referrals" },
  { href: "/admin/settings", label: "Settings", title: "This Weft install" },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5">
      {ADMIN_TABS.map((t) => {
        const on = isActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            title={t.title}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg px-2.5 py-1 transition-colors ${on ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

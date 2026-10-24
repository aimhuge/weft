// Layout for /admin/users, /admin/billing, /admin/coupons and /admin/settings. The body is full-screen
// (the root layout is overflow-hidden and would clip the table), so we let
// the admin pages scroll naturally. The page itself calls
// `requireSuperAdminWeft`, which short-circuits with notFound() for
// non-admins — a 404 leaks less than a 403 (it doesn't confirm the route
// exists).
//
// A small top bar with a "← Board" link sits above the page so the SuperAdmin
// can return to the board without using the browser back button (which on
// the deployed weft.zip would walk into the marketing site instead).
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-root flex h-full min-h-0 flex-col overflow-auto bg-canvas text-ink">
      <header className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel/90 px-5 py-2.5 text-[13px] text-muted backdrop-blur">
        <Link href="/" className="mr-2 rounded-lg border border-line bg-canvas px-2.5 py-1 text-ink transition-colors hover:bg-sunken" title="Back to the board">
          ← Board
        </Link>
        <Link href="/admin/users" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Weft users (auth.users)">Users</Link>
        <Link href="/admin/billing" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Workspace plans, refunds and resets">Billing</Link>
        <Link href="/admin/coupons" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Coupon codes and referrals">Coupons</Link>
        <Link href="/admin/billing" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Workspace plans, refunds and resets">Billing</Link>
        <Link href="/admin/coupons" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Coupon codes and referrals">Coupons</Link>
        <Link href="/admin/settings" className="rounded-lg px-2.5 py-1 transition-colors hover:bg-sunken hover:text-ink" title="Local install overview">Settings</Link>
        <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-faint">SuperAdmin</span>
      </header>
      {children}
    </div>
  );
}

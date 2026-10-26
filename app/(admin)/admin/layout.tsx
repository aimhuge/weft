// Layout for /admin/users, /admin/billing, /admin/coupons and /admin/settings. The body is full-screen
// (the root layout is overflow-hidden and would clip the table), so we let
// the admin pages scroll naturally. The page itself calls
// `requireSuperAdminWeft`, which short-circuits with notFound() for
// non-admins — a 404 leaks less than a 403 (it doesn't confirm the route
// exists).
//
// A small top bar with a "← Board" link sits above the page so the SuperAdmin
// can return to the board without using the browser back button (which on
// the deployed weft.zip would walk into the marketing site instead). Esc does the same (AdminEscape). In the
// desktop app on a Mac the bar is the title bar too, clear of the traffic lights (AdminBar).
// The pages are built from the admin kit in components/admin.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { accountView } from "@/lib/account";
import AdminBar from "./AdminBar";
import AdminEscape from "./AdminEscape";
import AdminNav from "./AdminNav";

// Who's signed in, on the bar's right. It reads the session, so it streams in behind its own Suspense.
async function SignedIn() {
  await connection();
  const { user } = await accountView();
  if (!user) return null;
  return (
    <span className="flex items-center gap-2 text-[12px] text-muted" title={user.email ?? ""}>
      {user.avatar ? <img src={user.avatar} alt="" className="h-5 w-5 rounded-full" /> : null}
      <span className="hidden sm:inline">{user.email}</span>
    </span>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-root flex h-full min-h-0 flex-col overflow-auto bg-canvas text-ink">
      <AdminEscape />
      <AdminBar>
        <Link href="/" className="rounded-lg px-2 py-1 text-muted transition-colors hover:bg-sunken hover:text-ink" title="Back to the board (Esc)">
          ← Board
        </Link>
        <span className="h-4 w-px bg-line-strong" aria-hidden />
        <span className="flex items-center gap-1.5 font-semibold">
          <span aria-hidden>🛡</span> Admin
        </span>
        <AdminNav />
        <div className="ml-auto">
          <Suspense fallback={null}>
            <SignedIn />
          </Suspense>
        </div>
      </AdminBar>
      {/* Each page's gate reads the session (connection()), which can't prerender: the Suspense lets the
          bar render at once and the page stream in, instead of Next's "blocking route" error. */}
      <Suspense fallback={<p className="px-6 py-6 text-[13px] text-faint">Loading…</p>}>{children}</Suspense>
    </div>
  );
}

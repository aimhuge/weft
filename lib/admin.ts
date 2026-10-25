// The server-side Weft super-admin gate:
//
//   - `requireSuperAdminWeft()` is the server gate. Reads the signed-in Weft
//     account from `lib/account.ts`, hands the email to `@aimhuge/admin`'s
//     `requireSuperAdmin` (which checks `SUPER_ADMIN_EMAILS` via
//     `@aimhuge/teams`'s `isSuperAdmin`), and returns the account for the page
//     to show in the banner. Throws notFound() for non-admins, so the route
//     404s (it leaks less than a 403).
//
// The client hook lives in `lib/use-admin-gate.ts`. Keep it separate so this
// module's Node-only account dependencies cannot enter the browser bundle.
//
// The allowlist is `SUPER_ADMIN_EMAILS` (comma-separated), read by
// `@aimhuge/teams` once at module load. We don't keep a second copy here.
import { requireSuperAdmin as adminRequireSuperAdmin, isAdminCaller } from "@aimhuge/admin";
import type { SuperAdminSession } from "@aimhuge/admin/client";
import { connection } from "next/server";
import { accountClient, accountView, toAccountUser } from "@/lib/account";
import type { AccountUser } from "@/lib/types";

// What the server gate returns: the gated account, ready for the page to
// render the SuperAdminBanner with.
export interface AdminCaller {
  email: string;
  user: AccountUser;
}

// Server gate. Throws notFound() when the caller isn't on SUPER_ADMIN_EMAILS.
// Use from a server component or API route that wants admin-only behaviour.
export async function requireSuperAdminWeft(): Promise<AdminCaller> {
  // The gate reads the signed-in session, which is per-request: without this
  // Next tries to prerender the admin pages and trips on the session's Date.now().
  await connection();
  const view = await accountView();
  const user = view.user;
  // The early branch handles the unsigned case without a non-null assertion.
  if (!user?.email) {
    adminRequireSuperAdmin({ email: null });
  }
  // requireSuperAdmin short-circuits with notFound() if the email isn't on
  // the allowlist, so the code below only runs for a signed-in super-admin.
  const email = adminRequireSuperAdmin({ email: user?.email ?? null });
  // The cast keeps the return shape narrow; the previous branch already
  // proved the account is signed in.
  return { email, user: user as AccountUser };
}

// Non-throwing variant for layouts that want to render differently, not block.
export async function isAdminWeft(): Promise<boolean> {
  await connection();
  const view = await accountView();
  if (!view.user?.email) return false;
  return isAdminCaller({ email: view.user.email });
}

// Server-side: returns a service-role Supabase client for the admin Users
// page to query across users with. Returns null when SUPABASE_SECRET_KEY is
// missing — the deployed weft has it set; the desktop install typically
// doesn't, and the page should say so rather than silently fail.
export async function adminServiceClient(): Promise<ReturnType<typeof accountClient> | null> {
  // Mirrors lib/web-session.ts serviceClient, but doesn't depend on a web
  // session — the admin gate already proved the caller is a super-admin.
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL } = await import("@/lib/supabase-project");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Re-export so the admin pages can build a SuperAdminSession without
// duplicating the AccountUser → SuperAdminSession shape.
export function adminSessionFrom(user: AccountUser): SuperAdminSession {
  return { id: user.id, email: user.email ?? "", name: user.name ?? user.email ?? "" };
}

export { toAccountUser };

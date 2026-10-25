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
// Two ways in: the `SUPER_ADMIN_EMAILS` env (comma-separated, read by `@aimhuge/teams` once at module
// load; the bootstrap) or a row in `public.super_admins` for the signed-in account (add one in the database,
// no redeploy). We don't keep a second copy of the env list here.
import { isAdminCaller } from "@aimhuge/admin";
import type { SuperAdminSession } from "@aimhuge/admin/client";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { accountClient, accountView, toAccountUser } from "@/lib/account";
import type { AccountUser } from "@/lib/types";

// What the server gate returns: the gated account, ready for the page to
// render the SuperAdminBanner with.
export interface AdminCaller {
  email: string;
  user: AccountUser;
}

// True when the account's own row is in `super_admins` (RLS lets a signed-in user read only that row).
// Any failure (no network, table missing, signed out) reads as "not a super admin".
async function inSuperAdminTable(user: AccountUser): Promise<boolean> {
  try {
    const { data } = await accountClient().from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    return data !== null;
  } catch {
    return false;
  }
}

async function isSuperAdminUser(user: AccountUser | null): Promise<boolean> {
  if (!user?.email) return false;
  return isAdminCaller({ email: user.email }) || (await inSuperAdminTable(user));
}

// Server gate. Throws notFound() when the caller isn't a super admin (env allowlist or `super_admins` row).
// Use from a server component or API route that wants admin-only behaviour.
export async function requireSuperAdminWeft(): Promise<AdminCaller> {
  // The gate reads the signed-in session, which is per-request: without this
  // Next tries to prerender the admin pages and trips on the session's Date.now().
  await connection();
  const { user } = await accountView();
  if (!user?.email || !(await isSuperAdminUser(user))) notFound();
  return { email: user.email, user };
}

// Non-throwing variant for layouts that want to render differently, not block.
export async function isAdminWeft(): Promise<boolean> {
  await connection();
  const { user } = await accountView();
  return isSuperAdminUser(user);
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

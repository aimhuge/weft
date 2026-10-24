import "server-only";

// Granting Open Source at sign-in (docs/architecture/billing.md). Weft's web sign-in is GitHub-only, so the moment
// someone signs in we know their GitHub login and, for that one request, hold their GitHub token: a free workspace
// whose owner maintains an active open-source repo moves onto `oss` for a year, and a granted one is renewed in
// its last month. The billing page's "Check open source" button runs the same check later without the token.

import type { SupabaseClient } from "@supabase/supabase-js";
import { billing, billingService } from "./billing";
import { grantPlan, renewDue, type GrantOutcome } from "./grants";
import { orgForUser } from "./org";
import { openSourceRepo, type GithubRepo, type OssDeps } from "./oss";
import { grantLapsed, isGrantPlan, isPaid } from "./plan-gate";

export type OssCheck =
  | { kind: "skipped"; reason: "no-workspace" | "paid" | "not-due" | "no-login" }
  | { kind: "not-eligible" }
  | { kind: "granted"; repo: string; outcome: GrantOutcome };

// The GitHub login a Supabase user signed in with (`user_metadata.user_name`), or null.
export function githubLogin(user: { user_metadata?: Record<string, unknown> | null } | null | undefined): string | null {
  const name = user?.user_metadata?.user_name;
  return typeof name === "string" && name ? name : null;
}

// Whether this workspace's plan is worth a GitHub check: Free, a lapsed or ending grant. A paying workspace, or a
// grant with more than a month left, isn't.
async function checkDue(service: SupabaseClient, orgId: string, now: Date): Promise<OssCheck | null> {
  const sub = await billing.subscription(service, orgId);
  if (isPaid(sub.plan) && sub.status !== "canceled") return { kind: "skipped", reason: "paid" };
  if (isGrantPlan(sub.plan) && !grantLapsed(sub.plan, sub.trialEnd, now) && !renewDue(sub.trialEnd, now)) {
    return { kind: "skipped", reason: "not-due" };
  }
  return null;
}

// Check the user's GitHub and grant their workspace Open Source when they qualify.
export async function checkOpenSource(
  service: SupabaseClient,
  userId: string,
  login: string | null,
  deps: OssDeps = {},
): Promise<OssCheck> {
  if (!login) return { kind: "skipped", reason: "no-login" };
  const org = await orgForUser(service, userId);
  if (!org) return { kind: "skipped", reason: "no-workspace" };
  const now = deps.now ?? new Date();
  const skip = await checkDue(service, org.id, now);
  if (skip) return skip;
  const repo: GithubRepo | null = await openSourceRepo(login, { ...deps, now });
  if (!repo) return { kind: "not-eligible" };
  return { kind: "granted", repo: repo.full_name, outcome: await grantPlan(service, org.id, "oss", now) };
}

// The billing page's button: the same check, reading the login from the user's auth record (no GitHub token now).
export async function checkOpenSourceFor(service: SupabaseClient, userId: string, deps: OssDeps = {}): Promise<OssCheck> {
  const { data } = await service.auth.admin.getUserById(userId);
  return checkOpenSource(service, userId, githubLogin(data.user), deps);
}

// The sign-in callback's hook: the check with the user's GitHub token, on the service client, never throwing. A
// failed check only means the grant waits for the next sign-in or the billing page's button.
export async function openSourceAfterSignIn(
  github: { userId: string; login: string; token: string | null },
  deps: OssDeps & { service?: SupabaseClient | null } = {},
): Promise<OssCheck | null> {
  const service = deps.service === undefined ? billingService() : deps.service;
  if (!service) return null;
  try {
    return await checkOpenSource(service, github.userId, github.login, { ...deps, token: github.token });
  } catch (err) {
    console.error(`[billing/oss] sign-in check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

"use server";
// The /[orgSlug]/billing page's server actions (docs/architecture/billing.md). Each one re-runs the gate
// (`requireTeam`), enforces the workspace-management permission, talks to the billing provider, and revalidates
// the billing page on success. The gate is what makes "a non-member cannot touch this org" true; the
// permission check is what makes "a member cannot change the plan" true. The action result type matches
// useActionState's contract: a tuple of (state, formAction) where the action returns the new state.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roleCan, type OrgRole } from "@aimhuge/teams";
import type { BillingInterval } from "@aimhuge/billing";
import { requireTeam } from "./teams";
import { billing } from "./billing/billing";
import { describeBillingError as describe, startUpgrade } from "./billing/checkout";
import { checkOpenSourceFor } from "./billing/oss-grant";
import { IP_COUNTRY_HEADER } from "./billing/regional-pick";
import type { CheckoutAnswer, UpgradeInterval, UpgradePlan } from "./billing/upgrade";

// The action result type. Successes either redirect (the action throws a redirect sentinel that
// Next handles) or return an `ok` status; failures carry a single `error` string the form can
// display inline.
export type BillingActionResult = { ok: true; message: string } | { ok: false; error: string };

function ok(message: string): BillingActionResult {
  return { ok: true, message };
}
function fail(error: string): BillingActionResult {
  return { ok: false, error };
}

// Whether the caller can change the workspace's plan. Owners and admins only — members can see billing
// but can't spend money on it.
function canManageBilling(role: OrgRole): boolean {
  return roleCan(role, "workspace.manage");
}

// Build the BillingContext the package's provider methods want. WebUser.email is `string | null`, and the
// provider expects `string | null`, so the conversion is the one the type already allows.
function billingContext(ctx: Awaited<ReturnType<typeof requireTeam>>) {
  return { service: ctx.service, orgId: ctx.org.id, orgSlug: ctx.org.slug, actorEmail: ctx.user.email };
}

// Start a Stripe Checkout for the Pro plan from the billing page's buttons. Members get a clear refusal; a Weft
// without a Stripe key is told billing isn't set up yet. lib/billing/checkout.ts does the work; this sends the
// browser on to Checkout, or re-renders the page when the change applied inline (a downgrade needs no new card).
export async function upgradeToPro(slug: string, interval: BillingInterval): Promise<BillingActionResult> {
  const answer = await upgradeCheckout(slug, "pro", interval);
  if (!answer.ok) return fail(answer.error);
  // redirect() throws Next's redirect signal, so it stays out of any try.
  if ("url" in answer) redirect(answer.url);
  return ok("Plan updated.");
}

// The upgrade dialog's checkout on weft.zip (components/UpgradeDialog.tsx): the same start as the billing page's
// buttons, for Pro or Team, answering with the Checkout URL for the dialog to open instead of redirecting.
export async function upgradeCheckout(slug: string, plan: UpgradePlan, interval: UpgradeInterval): Promise<CheckoutAnswer> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  // No ?checkout=done here: the Stripe provider adds it (and the session id) to the success URL itself.
  const answer = await startUpgrade(
    { service: ctx.service, orgId: ctx.org.id, orgSlug: ctx.org.slug, actorEmail: ctx.user.email, role: ctx.role },
    { plan, interval, ipCountry: (await headers()).get(IP_COUNTRY_HEADER), returnPath: `/${slug}/billing` },
  );
  if (answer.ok && !("url" in answer)) revalidatePath(`/${slug}/billing`);
  return answer;
}

// Open the workspace's customer portal. Owner or admin only. When the provider has no portal (the mock),
// the result is null and we tell the caller — there's no fallback URL to send them to.
export async function manageBilling(slug: string): Promise<BillingActionResult> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!canManageBilling(ctx.role)) return fail("Ask an owner to manage billing.");
  const provider = billing.provider();
  let url: string | null;
  try {
    url = await provider.billingPortalUrl(billingContext(ctx), `/${slug}/billing`);
  } catch (err) {
    return fail(describe(err));
  }
  if (!url) return fail("This provider has no billing portal.");
  redirect(url);
}

// Schedule cancellation at the end of the current period. The provider reflects it in `cancelAtPeriodEnd`,
// so the page re-renders with the "cancels on …" notice and a Resume button.
export async function cancelPro(slug: string): Promise<BillingActionResult> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!canManageBilling(ctx.role)) return fail("Ask an owner to cancel the plan.");
  const provider = billing.provider();
  try {
    await provider.cancelSubscription(billingContext(ctx));
  } catch (err) {
    return fail(describe(err));
  }
  revalidatePath(`/${slug}/billing`);
  return ok("Cancellation scheduled. Access continues until the end of your billing period.");
}

// Undo a scheduled cancellation. Safe to call when nothing is scheduled — the provider returns the
// current subscription either way.
export async function resumePro(slug: string): Promise<BillingActionResult> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!canManageBilling(ctx.role)) return fail("Ask an owner to resume the plan.");
  const provider = billing.provider();
  try {
    await provider.resumeSubscription(billingContext(ctx));
  } catch (err) {
    return fail(describe(err));
  }
  revalidatePath(`/${slug}/billing`);
  return ok("Cancellation undone.");
}

// Check the signed-in user's GitHub for an open-source repo and grant the workspace Open Source when it qualifies.
// Owner or admin only, like any plan change. GitHub is read without a token here, so it counts against Vercel's IP limit.
export async function checkOpenSourceNow(slug: string): Promise<BillingActionResult> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!canManageBilling(ctx.role)) return fail("Ask an owner to check open source.");
  let check: Awaited<ReturnType<typeof checkOpenSourceFor>>;
  try {
    check = await checkOpenSourceFor(ctx.service, ctx.user.id);
  } catch (err) {
    return fail(describe(err));
  }
  revalidatePath(`/${slug}/billing`);
  if (check.kind === "granted" && check.outcome.granted) return ok(`Open Source granted for ${check.repo}.`);
  if (check.kind === "skipped" && check.reason === "paid") return fail("This workspace pays for Pro or Team, which already includes everything.");
  if (check.kind === "skipped" && check.reason === "not-due") return ok("Your Open Source grant is current.");
  if (check.kind === "skipped" && check.reason === "no-login") return fail("Sign in with GitHub to check.");
  return fail("No active, OSI-licensed public repo you maintain clears the bar yet.");
}

// The page's <form action> wants an action that returns nothing, so these run one of the actions above and carry a
// refusal back to the page as ?error=… (a success has already redirected or revalidated).
async function orBack(slug: string, result: Promise<BillingActionResult>): Promise<void> {
  const outcome = await result;
  if (!outcome.ok) redirect(`/${slug}/billing?error=${encodeURIComponent(outcome.error)}`);
}

export async function upgradeForm(slug: string, interval: BillingInterval): Promise<void> {
  await orBack(slug, upgradeToPro(slug, interval));
}

export async function manageForm(slug: string): Promise<void> {
  await orBack(slug, manageBilling(slug));
}

export async function cancelForm(slug: string): Promise<void> {
  await orBack(slug, cancelPro(slug));
}

export async function resumeForm(slug: string): Promise<void> {
  await orBack(slug, resumePro(slug));
}

export async function checkOpenSourceForm(slug: string): Promise<void> {
  await orBack(slug, checkOpenSourceNow(slug));
}

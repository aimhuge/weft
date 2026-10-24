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
import { BillingError, type BillingInterval } from "@aimhuge/billing";
import { requireTeam } from "./teams";
import { billing, billingConfigured } from "./billing/billing";
import { checkOpenSourceFor } from "./billing/oss-grant";
import { IP_COUNTRY_HEADER, regionalPick } from "./billing/regional-pick";

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

// A `BillingError` is safe to show the customer verbatim; anything else is ours and gets logged with its
// message so a real bug is traceable without the customer seeing a raw Stripe or Postgres string.
function describe(err: unknown): string {
  if (err instanceof BillingError) return err.message;
  console.error(`Billing action: ${err instanceof Error ? err.message : "unknown"}`);
  return "Something went wrong on our end. Try again in a moment.";
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

// Start a Stripe Checkout for the Pro plan. Members get a clear refusal; a Weft without a Stripe key
// (BILLING_PROVIDER !== "stripe" or no STRIPE_SECRET_KEY) is told billing isn't set up yet. The provider
// returns either a hosted-checkout URL to redirect to, or an inline-applied result (a downgrade needs no
// new authorization, so it just applies — we won't see that path on a Free→Pro move, but we handle it).
export async function upgradeToPro(slug: string, interval: BillingInterval): Promise<BillingActionResult> {
  const ctx = await requireTeam(slug, `/${slug}/billing`);
  if (!canManageBilling(ctx.role)) return fail("Ask an owner to change the plan.");
  if (!billingConfigured()) return fail("Billing isn't set up on this Weft yet.");
  const provider = billing.provider();
  // Regional prices are monthly only. `priceVariant` picks the Stripe price; a billing package without variant
  // support ignores it and sells the full price (docs/architecture/billing.md).
  const regional = interval === "monthly" ? await regionalPick(ctx.service, ctx.org.id, (await headers()).get(IP_COUNTRY_HEADER)) : null;
  let result: Awaited<ReturnType<typeof provider.startCheckout>>;
  try {
    const input: Parameters<typeof provider.startCheckout>[1] & { priceVariant?: string } = {
      plan: "pro",
      interval,
      seats: 1,
      returnPath: `/${slug}/billing?checkout=done`,
      ...(regional && { priceVariant: regional.variant }),
    };
    result = await provider.startCheckout(billingContext(ctx), input);
  } catch (err) {
    return fail(describe(err));
  }
  // Outside the try: redirect() throws Next's redirect signal, which a catch would turn into an error.
  if (result.kind === "redirect") redirect(result.url);
  // Inline-applied: a downgrade or a same-plan change. Nothing to send them to; the page re-renders.
  revalidatePath(`/${slug}/billing`);
  return ok("Plan updated.");
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

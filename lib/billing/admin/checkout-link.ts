import "server-only";

// A Checkout link an admin makes for a workspace (docs/architecture/billing.md "Admin console"): the way to upgrade a Free
// workspace from the console, since moving onto a paid plan needs the customer's card. Made in the deployment's own mode,
// the one its webhook listens to, so the purchase lands on the row like any other. An optional promotion code is applied
// up front; without one the customer may still type a code on the page.

import type Stripe from "stripe";
import { siteOrigin } from "./site";
import { audit, loadRow, type AdminCtx } from "./context";
import { AdminBillingError, detectMode, type StripeMode } from "./stripe-keys";
import { priceFor, readChange } from "./subscription-ops";
import { findPromotionCode } from "./coupons";

// The deployment's own mode and its client: the mode its webhook listens to.
function defaultClient(ctx: AdminCtx): { mode: StripeMode; client: Stripe } {
  const mode = ctx.stripe.defaultMode();
  const client = mode && ctx.stripe.client(mode);
  if (!mode || !client) throw new AdminBillingError("STRIPE_SECRET_KEY isn't set, so this Weft can't make a checkout.");
  return { mode, client };
}

async function orgSlug(ctx: AdminCtx): Promise<string> {
  const { data: org } = await ctx.service.from("orgs").select<string, { slug: string }>("slug").eq("id", ctx.orgId).maybeSingle();
  if (!org?.slug) throw new AdminBillingError("No such workspace.");
  return org.slug;
}

// Reuse the row's customer only when it lives in this mode; a sandbox id would make a live Checkout fail.
async function customerIn(ctx: AdminCtx, customerId: string | null, mode: StripeMode): Promise<string | undefined> {
  const found = await detectMode(ctx.stripe, { customerId, subscriptionId: null });
  return found.mode === mode && !found.deleted && customerId ? customerId : undefined;
}

// A typed code goes on the session up front; without one the customer may still type a code on the page.
async function discountFor(client: Stripe, mode: StripeMode, code: string) {
  if (!code) return { allow_promotion_codes: true };
  const promotion = await findPromotionCode(client, code);
  if (!promotion) throw new AdminBillingError(`No active promotion code ${code} in ${mode} mode.`);
  return { discounts: [{ promotion_code: promotion.id }] };
}

export async function checkoutLink(ctx: AdminCtx, body: Record<string, unknown>): Promise<{ url: string }> {
  const input = readChange(body);
  const { mode, client } = defaultClient(ctx);
  const row = await loadRow(ctx.service, ctx.orgId);
  if (row?.provider_subscription_id && row.status !== "canceled") throw new AdminBillingError("This workspace already has a subscription. Change its plan instead.");
  const slug = await orgSlug(ctx);
  const code = typeof body.promotionCode === "string" ? body.promotionCode.trim() : "";
  const metadata = { app: "weft", org_id: ctx.orgId, org_slug: slug };
  const returnUrl = `${siteOrigin()}/${slug}/billing`;
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: await customerIn(ctx, row?.provider_customer_id ?? null, mode),
    line_items: [{ price: await priceFor(client, mode, input.plan, input.interval), quantity: input.seats }],
    success_url: `${returnUrl}?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnUrl}?checkout=canceled`,
    metadata,
    subscription_data: { metadata },
    client_reference_id: ctx.orgId,
    ...(await discountFor(client, mode, code)),
  });
  if (!session.url) throw new AdminBillingError("Stripe didn't return a checkout page.");
  await audit(ctx, "checkout_link", { mode, plan: input.plan, interval: input.interval, seats: input.seats, promotionCode: code || null, session: session.id });
  return { url: session.url };
}

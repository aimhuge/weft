# 036: Stripe Checkout came back to `?checkout=done?checkout=done`, so the billing page never reconciled

**Date:** 2026-10-24 · **Severity:** Low (the plan still changed when the webhook landed; the page just showed the old
plan for a few seconds after paying, the very thing the reconcile is there to prevent)

## Symptom

After paying in Stripe Checkout from the billing page on weft.zip, you landed on a URL like
`/acme/billing?checkout=done?checkout=done&session_id=cs_…`. The page is meant to re-read the subscription from Stripe
when it sees `?checkout=done`, so it shows Pro before the webhook arrives. It never did: it showed Free until the next
load after the webhook.

## Cause

`@aimhuge/billing`'s Stripe provider builds the success URL itself:

```js
const returnUrl = `${stripe.config().siteOrigin}${input.returnPath}`;
success_url: `${returnUrl}?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
cancel_url: `${returnUrl}?checkout=canceled`,
```

`upgradeToPro` in `lib/billing-actions.ts` already passed the query in its return path:

```ts
returnPath: `/${slug}/billing?checkout=done`,
```

So the URL carried two `?`. The second one is part of the first parameter's value, `checkout` read as
`"done?checkout=done"`, and `readQuery` in `app/[orgSlug]/billing/page.tsx` (`query.checkout === "done"`) was false.

## Fix

The return path is the bare page; the provider adds the query (`lib/billing-actions.ts` `upgradeCheckout`, which
`upgradeToPro` now calls through `startUpgrade` in `lib/billing/checkout.ts`):

```ts
// No ?checkout=done here: the Stripe provider adds it (and the session id) to the success URL itself.
{ plan, interval, ipCountry, returnPath: `/${slug}/billing` },
```

The desktop's checkout returns to `/checkout/done` the same way, and that page reads `?checkout=canceled` from the
cancel URL. `lib/billing-actions.test.ts` and `lib/billing-actions-regional.test.ts` pin `returnPath: "/acme/billing"`.

**Key rule:** a `returnPath` handed to `@aimhuge/billing` is a path with no query; the provider owns the query.

## Files

- `lib/billing-actions.ts`, `lib/billing/checkout.ts`
- `lib/billing-actions.test.ts`, `lib/billing-actions-regional.test.ts`
- `app/checkout/done/page.tsx`

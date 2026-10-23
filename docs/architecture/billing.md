# Billing

Status: built 2026-10-13; needs the migration applied, Stripe set up and a deploy before it works.

Weft has three plans per workspace: **Free**, **Pro** and **Team**. Pro is $20 a month or $200 a year (two months
free) and replaces the Puku trial's daily cap with a 300M Puku token allowance, refreshed every billing period.
Team is $9 per seat a month, carries the same allowance, and is the per-seat shape `@aimhuge/billing`'s DeckCP
catalog documents. Having people is a paid capability: Free is a team of one, Pro and Team may invite
(see [teams.md](teams.md)).
Billing lives on the deployed Weft (weft.zip), on the same Stripe account the other AimHuge apps share,
with `app: "weft"` and a webhook of its own. The desktop reads the plan, the period and the Puku meter
through one small endpoint; the manage page and Checkout live on the site.

## The package

`@aimhuge/billing` v0.5.0 is installed with pnpm from the components repo (`github:aimhuge/components#v0.5.0&path:/packages/billing`).
Weft imports its `defineCatalog`, `createBilling`, `subscription`, `balance`, `recordUsage` and `MeterBalance`
types from it, and the package's two SQL files (`0001` subscriptions/invoices/payment methods/billing profiles/
audit log/webhook idempotency, `0002` the metered-usage ledger) are copied verbatim into
`supabase/migrations/20261014010429_billing.sql` (no changes; the upstream `create ... if not exists`
form makes it a no-op where the tables already exist). Every billing table is RLS-on with no policies,
so only the service-role client on the deployed Weft can read or write them.

## The plans

`lib/billing/plans.ts` holds the catalog: `PlanId` is `"free" | "pro" | "team"`, and the plans come out in
`order: ["free", "pro", "team"]` (cheapest first, which is also what makes `catalog.isUpgrade("pro", "team")` true).
It's client-safe — a board-side plan picker, and the home page's pricing section
([marketing-site.md](marketing-site.md)), import it without pulling in Supabase or Stripe. The token count is the same
as `lib/puku-proxy.ts`: input (including cache writes) plus output, cache reads don't count.

| Plan | Price | Puku allowance | Teams | BlastCP |
| --- | --- | --- | --- | --- |
| Free | $0 | none (Puku trial's daily cap applies) | team of one | `BLASTCP_FREE` |
| Pro | $20/month or $200/year (`yearlyMonthsCharged: 10`) | `PRO_PUKU_TOKENS` = 300,000,000 per period | yes | `BLASTCP_CREATOR` |
| Team | $9/seat/month (`TEAM_SEAT_CENTS = 900`, `perSeat: true`) | `PRO_PUKU_TOKENS` = 300,000,000 per period | yes | `BLASTCP_CREATOR` |

### BlastCP usage

Each plan includes a BlastCP tier (`plan.blastcp`, a `BlastcpTier`). The figures copy BlastCP's own catalog
(aimhuge/blastcp `src/lib/billing/plans.ts`), so a change there needs the same change here:

| | Brands | Channels | Posts / month | AI generation credit |
| --- | ---: | ---: | ---: | ---: |
| `BLASTCP_FREE` (Weft Free) | 1 | 3 | 30 | $0.50, once (`creditResets: false`) |
| `BLASTCP_CREATOR` (Weft Pro, Team) | 1 | every (`null`) | unlimited (`null`) | $3 a month |

Team also gets Creator, not BlastCP Pro: BlastCP Pro is $29 flat, and a one-seat Team only pays $9. BlastCP Pro and Agency
(more brands and seats) are sold on BlastCP itself, so Weft has no fourth tier for them. **Not built yet: enforcement.**
Today the bundle is just what the pricing section says. No Weft subscription reaches a BlastCP workspace: BlastCP would
have to read the Weft plan when an account connects through the token exchange ([blastcp.md](blastcp.md)) and set its own
`org_subscriptions` row to match.

Team follows `@aimhuge/billing`'s DeckCP catalog: `perSeat: true` means the Stripe price is a **per-unit** recurring
price and the seat count rides on the subscription's `quantity`, so a five-seat workspace is 5 × 900 cents.
`catalog.totalCents("team", "monthly", seats)` does that arithmetic. Pro's own yearly option is unaffected.

## The team gate

Teams are the one thing a plan unlocks rather than meters. `lib/billing/plan-gate.ts` (server-only) is the whole
rule:

- **`TEAM_PLANS = ["pro", "team"]`** — the list, in one place.
- **`canHaveMembers(plan)`** — takes a plain string, because the value it gets is whatever is in a `text` column.
  Free is absent, and an unknown id is false: `TEAM_PLANS.includes(...) && catalog.get(plan).id === plan`, so the
  catalog's own fallback to `free` is the second half of the refusal.
- **`workspacePlan(service, orgId)`** — one read of `org_subscriptions` (`plan, status`, `.eq("org_id", orgId)`,
  `maybeSingle()`), mapped to a `PlanId`.
- **`workspaceCanHaveMembers(service, orgId)`** — the two together, for the callers that gate on it.

It **fails closed**, and that is the point rather than a hedge: no subscription row, a `plan` that isn't a string, a
plan id the catalog doesn't know, a `status` that is present and isn't `active` or `trialing`, or a client that
throws — each answers `"free"`, i.e. no members. `readSubscription` catches, so `workspacePlan` never propagates: a
Supabase hiccup can neither unlock a paid capability nor 500 an invite form. `past_due` is the intended case — the
workspace is downgrading, and `meteredStatuses` in `lib/billing/billing.ts` has already stopped it spending Pro
tokens.

`lib/team-ops.ts` `runInvite` calls it, after the cheap synchronous input checks (`checkInvite`: the actor's role,
the address, the assignable role, the self-invite) and before the profile lookup or the mailer, so a locked
workspace costs nothing and never sends a half-accepted invite. The refusal is `TEAM_GATE_MESSAGE` from the same
file, so the invite op and any upsell note can't drift apart. Role changes, removal and self-leave are **not** gated:
a workspace is always escapable, and you can always leave.

`PRO_PUKU_TOKENS` is a placeholder the user will tune: 300M is a comfortable starting point for a Pro or Team
workspace, and changing it later only affects subscribers' next period, not the current one (the
subscription row freezes `unit_amount_cents` at purchase; the allowance comes from the catalog at read time
and applies at the start of every new period). `PUKU_METER` (`"puku_tokens"`) is the only meter today, and
its charges are written to `org_usage_charges` (`refType: "puku_request"`, `createdVia: "system"`). Pro and Team
read the same number, so there is one knob, not two. The home page's pricing section renders it in millions from
the same constant ([marketing-site.md](marketing-site.md)).

## Metering in the proxy

`lib/billing/puku-meter.ts` implements the `PlanMeter` interface from `lib/puku-proxy.ts`:

- **`check(userId)`** looks up the user's workspace (`lib/billing/org.ts` `orgForUser`: `profiles.current_org_id`
  if the org still exists and the user is a member, else the user's oldest owner membership, else null),
  reads the workspace's subscription, and returns `{ orgId, remaining }` when the plan has a Puku allowance
  with tokens left. A null is "no Pro allowance" — the proxy keeps the daily free trial cap on for that
  user. Cached per user for 15 s (`CACHE_MS`) so a burst of Puku requests doesn't hammer the database, and each
  recorded charge comes straight off every cached answer for that workspace, so a team sharing one allowance can't
  spend it once per member, and overspend stays within the requests already in flight;
  the cache is wiped between tests with `resetMeterCache()`. A `past_due` status falls back to the free
  plan's allowance (`meteredStatuses: ["active", "trialing"]` in `lib/billing/billing.ts`), so Stripe's
  dunning still runs but the workspace stops spending Pro tokens while a payment is failing.
- **`record(orgId, userId, tokens)`** writes a row to `org_usage_charges` for the Pro workspace through
  `billing.recordUsage`. A non-positive amount is a no-op; the proxy only calls this with positive totals
  at end of stream.

A failed `check` or `record` is logged and the request falls back to the Free path (`puku-proxy.ts` `admit`).
A billing outage must not block anyone: the daily trial cap is the safety net.

## Flow

```
desktop Weft.app                              weft.zip (Vercel)                      Stripe                Supabase
   │                                                 │                                  │                      │
   │ Settings → Accounts (BillingStatus)             │                                  │                      │
   │  GET /api/account/billing ────────────────────▶ │                                  │                      │
   │                                                 │ /api/billing/status              │                      │
   │                                                 │  accountUserId(token) ─────────── │ ─── Auth ────────▶  │
   │                                                 │  orgForUser(svc, user) ────────── │ ──── PostgREST ───▶ │
   │                                                 │  billing.subscription + balance  │                     │
   │  BillingStatus JSON ◀────────────────────────── │ ◀────                            │                      │
   │                                                 │                                  │                      │
   │ User clicks "Upgrade to Pro" or "Manage"        │                                  │                      │
   │  openExternal(weft.zip/<slug>/billing) ───────▶ │                                  │                      │
   │                                                 │ /<slug>/billing (server action)  │                      │
   │                                                 │  createCheckoutSession ─────────▶ │                      │
   │                                                 │                                  │                      │
   │                                                 │ ◀── Stripe Checkout URL ───────── │                      │
   │  Browser opens Checkout                         │                                  │                      │
   │                                                 │                                  │                      │
   │                                                 │  checkout.session.completed      │                      │
   │                                                 │ ◀──── webhook ─────────────────── │                      │
   │                                                 │  verify signature                │                      │
   │                                                 │  insert idempotency row          │                      │
   │                                                 │  upsert subscription             │                      │
   │                                                 │  org_billing_events ← append     │                      │
   │                                                 │                                  │                      │
   │                                                 │  invoice.paid                    │                      │
   │                                                 │ ◀──── webhook ─────────────────── │                      │
   │                                                 │  upsert invoice, mark paid       │                      │
```

The puku-proxy half (the same proxy that hosts the trial) calls `pukuMeter(service).check(userId)` for
each messages request. On hit with tokens left, the daily cap is skipped (the per-day stats still update)
and the tokens spent are charged to the workspace through `pukuMeter(service).record(orgId, userId, tokens)`
at end of stream.

## The pieces

- **`/api/billing/status`** (`app/api/billing/status/route.ts`): the desktop's read-only view. No localhost
  guard — it's reached from your machine, not from localhost, and the Weft access token is the check (the
  same way `/api/puku/trial-token` does it). Returns 401 on a missing token, 503 on a deployment without
  `SUPABASE_SECRET_KEY`, 404 on a user with no workspace, and the `BillingStatus` JSON otherwise.
- **`/api/account/billing`** (`app/api/account/billing/route.ts`): the board's localhost-only proxy of the
  above. `lib/billing-client.ts` `fetchBillingStatus()` posts the user's Supabase access token to
  `${WEFT_BILLING_URL}/api/billing/status`; `null` means signed out (the section hides itself), `{ error }`
  is a short message the section shows, and the JSON is what `components/BillingStatus.tsx` renders.
- **`lib/billing/status.ts` `billingStatus(service, userId)`**: the desktop's view of a workspace — its
  plan, status, interval, period end, `cancelAtPeriodEnd` and the Puku `MeterBalance` when the plan has
  an allowance on the meter, plus the deployed Weft's manage page URL. `null` when the user has no
  workspace.
- **`components/BillingStatus.tsx`**: Settings → Accounts → Weft account section's plan row. Renders nothing
  when signed out, a one-line error on a non-OK reply, and `Plan: <name> · <workspace>` with a thin
  Puku-usage bar (spent of `allowance + granted`, resets on the period end) and a **Manage billing** /
  **Upgrade to Pro** button that opens the deployed Weft's page in the system browser. Refetches on window
  focus, so coming back from Checkout updates it.
- **`/api/billing/webhook`** (planned, the same thread as the billing page): Stripe's POST target on
  `https://weft.zip/api/billing/webhook`. Mounts the 9 events listed below, verifies the signature with
  `STRIPE_WEBHOOK_SECRET`, records the event in `billing_webhook_events` (PK on the Stripe event id, so a
  retried delivery is a unique violation rather than a duplicate write) and dispatches the right
  `billing.*` call (subscription upsert, invoice mirror, payment method attach/detach).
- **Billing page** (`app/[orgSlug]/billing/page.tsx`, planned): the workspace-scoped manage page on weft.zip
  (`/team` is the roster; `/<slug>/billing` is the same shell with the plan and invoices). Server actions
  in `lib/billing-actions.ts` handle Checkout (creates a `customer` if needed, hands back a Stripe Checkout
  URL), the portal (Stripe's hosted billing portal for an existing customer), the default payment method
  swap and the plan switch. Role rules: owner or admin can manage; member can only view.

The mock provider that ships in `@aimhuge/billing` is the default and lets every test run without Stripe,
but the mock has no hosted checkout page in Weft — for real customers you need `BILLING_PROVIDER=stripe`.

## Environment

All environment variables live on the deployed Weft (Vercel), held in the 🔐 vault (production) and pushed
with **Push to Vercel** or `mcp__secrets__push_to_vercel`.

| Name | Where | What |
| --- | --- | --- |
| `BILLING_PROVIDER` | Vercel | Must be `stripe` for real customers; the package's `mock` is the default and is fine for tests and local dev. |
| `STRIPE_SECRET_KEY` | 🔐 vault → Vercel | The shared AimHuge Stripe account's secret key (`sk_…`). Restricted to the Weft product. |
| `STRIPE_WEBHOOK_SECRET` | 🔐 vault → Vercel | The signing secret for the `weft.zip/api/billing/webhook` endpoint, shown once in the Stripe dashboard when the endpoint is created. |
| `STRIPE_PRICE_PRO_MONTHLY` | Vercel | The `price_…` for the $20/month recurring price (US only for now). |
| `STRIPE_PRICE_PRO_YEARLY` | Vercel | The `price_…` for the $200/year recurring price. |
| `STRIPE_PRICE_TEAM_MONTHLY` | Vercel | The `price_…` for the **$9 per seat per month** recurring price. A per-unit price: seats ride on the subscription's `quantity`. Nothing reconciles it against `TEAM_SEAT_CENTS`, so a mismatch is a real bug (the package throws on first use with the whole list of missing variables). |
| `SUPABASE_SECRET_KEY` | already on Vercel (webhook relay, Puku trial) | Service role; reads and writes the billing tables. |
| `NEXT_PUBLIC_SITE_URL` | Vercel | `https://weft.zip` by default. Used to build the `manageUrl` on `BillingStatus`. |

## Setup steps

1. **Apply the migration.** The Supabase drawer's **Migrate** (or `supabase db push`) for
   `supabase/migrations/20261014010429_billing.sql`, after the teams migration
   (`20261013155754_teams.sql`).
2. **Create the Stripe product.** On the shared AimHuge Stripe account, create the product "Weft Pro"
   with two per-unit recurring prices: $20/month (`STRIPE_PRICE_PRO_MONTHLY`) and $200/year
   (`STRIPE_PRICE_PRO_YEARLY`). Add a "Weft Team" product with one **per-unit** recurring price at $9 per seat per
   month (`STRIPE_PRICE_TEAM_MONTHLY`) — the seat count is the subscription quantity, so a five-seat workspace is
   $45 a month, not $9. Create the Stripe prices to match the catalog exactly; nothing in Weft reconciles them.
3. **Add the webhook endpoint.** `https://weft.zip/api/billing/webhook`, with the 9 events from the
   🪝 stripe blank: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `customer.updated`, `invoice.paid`,
   `invoice.payment_failed`, `payment_method.attached`, `payment_method.detached`. Copy the signing
   secret into the vault as `STRIPE_WEBHOOK_SECRET`.
4. **Fill the vault blanks and push them.** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_TEAM_MONTHLY`. Push them to Vercel with
   **Push** in the ▲ drawer (Touch ID per push) or `mcp__secrets__push_to_vercel`.
5. **Deploy.** The next deploy activates the billing route. Verify with a test card in the Stripe
   Checkout flow (the standard `4242 4242 4242 4242` test number, Stripe's mock customer and
   subscription should land in the workspace within seconds of `checkout.session.completed`).

## Files

- `lib/billing/plans.ts` + `lib/billing/plans.test.ts` — the catalog (client-safe).
- `lib/billing/plan-gate.ts` + `lib/billing/plan-gate.test.ts` — `TEAM_PLANS`, `canHaveMembers`, `workspacePlan`,
  `workspaceCanHaveMembers`: which plans may have members (server-only).
- `lib/billing/billing.ts` + `lib/billing/billing.test.ts` — `createBilling`, `billingService`, `billingConfigured` (server-only).
- `lib/billing/org.ts` + `lib/billing/org.test.ts` — `orgForUser` (server-only).
- `lib/billing/puku-meter.ts` + `lib/billing/puku-meter.test.ts` — the `PlanMeter` the proxy uses (server-only).
- `lib/billing/status.ts` + `lib/billing/status.test.ts` — `billingStatus`, the desktop's read-only view (server-only).
- `lib/billing-client.ts` + `lib/billing-client.test.ts` — the desktop's bridge to the deployed Weft's `/api/billing/status`.
- `app/api/billing/status/route.ts` + `app/api/billing/status/route.test.ts` — the deployed Weft's endpoint.
- `app/api/account/billing/route.ts` + `app/api/account/billing/route.test.ts` — the board's localhost-only proxy.
- `components/BillingStatus.tsx` + `components/BillingStatus.test.tsx` — Settings → Accounts → Weft account plan row.
- `app/[orgSlug]/billing/sections.tsx` — the Billing page's pieces; its invoices are tickets (`InvoiceTicket`) that link to the sheet.
- `app/[orgSlug]/billing/invoices/[number]/page.tsx` + `components/team/InvoiceSheet.tsx` (+ test) + `components/team/ScanCode.tsx` — one invoice
  as a full page: read through `billing.invoice(service, orgId, number)` (org-scoped, so another workspace's number is a 404) and drawn
  from the invoice's own frozen figures (lines, tax, paid, due, period), with the default card from `billing.account`, the billing profile's
  company and email as addressee, and the provider's `pdfUrl` / `hostedUrl` as the only ways out (the scan stripe is decoration). The look
  is `components/team/team.css` (`wz-sheet*`, `wz-invoice*`); `@media print` leaves the sheet alone, so the browser's Print is a PDF too.
- `supabase/migrations/20261014010429_billing.sql` — the package's two SQL files, copied verbatim.

## Known gaps

- The mock provider has no hosted checkout page in Weft, so billing needs `BILLING_PROVIDER=stripe` to
  take a real payment. The mock is fine for tests and a local dev run.
- `checkoutBranding` isn't set yet — Stripe Checkout uses its default. Adding the Weft brand (icon, brand
  colour) is a one-line `checkout.session.create` parameter once decided.
- Token pricing is a placeholder: `PRO_PUKU_TOKENS = 300_000_000` in `lib/billing/plans.ts`. The user will
  tune it. Stripe doesn't enforce a per-period token count; the catalog does, and a lower number for a
  subscriber only affects their next period.
- Team is in the catalog and gated on, but the billing page that would sell it (checkout, the plan switch, the seat
  count on Stripe) is still on the other card. Until `STRIPE_PRICE_TEAM_MONTHLY` exists, a Team subscription can be
  created by the package and nothing on weft.zip can buy one. Seat changes (add a person, raise the quantity) are
  the same missing piece: the gate lets members in on Team, but the seat count has to be kept in step with the
  roster by hand until the billing page does it.
- Concurrent requests can overdraw by one request. The package accepts this race — the meter writes a row,
  not a counter, and the balance is derived. A burst of N requests at `remaining: 1` can all see the
  one-token allowance and all spend; the next check sees zero. The 15 s `CACHE_MS` keeps the window
  small.
- The billing page (`/api/billing/webhook`, `app/[orgSlug]/billing/page.tsx`, `lib/billing-actions.ts`)
  is on another card: this doc covers the wiring that's already in `lib/billing/`, the desktop status,
  the proxy and the meter.

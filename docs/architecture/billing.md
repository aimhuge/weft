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

`lib/billing/plans.ts` holds the catalog: `PlanId` is `"free" | "oss" | "edu" | "pro" | "team"`, and the plans come out in
`order: ["free", "oss", "edu", "pro", "team"]` (cheapest first, which is also what makes `catalog.isUpgrade("pro", "team")` true;
`catalog.paid` is still `["pro", "team"]`, so Stripe needs no price for the two $0 plans).
It's client-safe — a board-side plan picker, and the home page's pricing section
([marketing-site.md](marketing-site.md)), import it without pulling in Supabase or Stripe. The token count is the same
as `lib/puku-proxy.ts`: input (including cache writes) plus output, cache reads don't count.

| Plan | Price | Puku allowance | Teams | BlastCP |
| --- | --- | --- | --- | --- |
| Free | $0 | none (Puku trial's daily cap applies) | team of one | `BLASTCP_FREE` |
| Open Source (`oss`) | $0, granted for 12 months | none (the free tier's cap) | yes | `BLASTCP_CREATOR` |
| Education (`edu`) | $0, granted for 12 months | none (the free tier's cap) | yes (a teacher's class) | `BLASTCP_CREATOR` |
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

## The free tier

`FREE_TIER` in `lib/billing/plans.ts` groups the plans with no Puku allowance of their own: they run on the Puku
trial's daily cap, **150 requests and 1M tokens per user per day** (cut from 300 and 2M on 2026-10-23).
`lib/puku-proxy.ts` `DAILY_REQUESTS` / `DAILY_TOKENS` read it, `freeTierCapLabel()` writes the "1M tokens a day"
that the Settings plan row and the billing page quote, and `PUKU_TRIAL_DAILY_*` on Vercel still override it
([puku-trial.md](puku-trial.md)). Its plans are `free`, `oss` and `edu`: a free plan never gets more tokens than this cap.

## Startups, Open Source, Education and regional pricing

Decided 2026-10-23 (Startups 2026-10-24):

| | Price | Puku | Teams | BlastCP | Who, and how we check |
| --- | --- | --- | --- | --- | --- |
| **Startups** (`team`) | $0 for 6 months, then half of `TEAM_SEAT_CENTS` for 6, then full | Pro's 300M per seat | yes, up to 10 seats | Creator | Companies under $5M raised and under 3 years old: an application (company site, founding date, amount raised), or straight through a partner accelerator's perks page. Once per company. **Not built.** |
| **Open Source** (`oss`) | $0 | free tier cap | yes | Creator | Maintainers of an active, non-fork public repo with an OSI licence, read from GitHub at sign-in (sign-in is GitHub-only). Re-checked every 12 months. **Built.** |
| **Education** (`edu`) | $0 | free tier cap | yes (teachers' classes) | Creator | Students and teachers in the GitHub Student Developer Pack (Weft applies as a pack partner; GitHub does the verifying). Yearly. **Plan and grant built; the redemption waits on the pack's offer format.** |
| **Regional pricing** ("LDN" internally) | $5/mo low income, $10/mo lower-middle income | Pro's 300M | yes | Creator | World Bank income groups, not the UN LDC list (Bangladesh, Laos and Nepal are scheduled to leave it in November 2026). Country from IP and billing address; the card's issuing country doesn't have to match. **Built in Weft; selling it needs `@aimhuge/billing` price variants (below).** |

**Startups** (`STARTUP_TEAM` in `lib/billing/plans.ts`, not built) is plan `team` at its full seat price, never a $0 plan
of its own, so the meter, the gate and the member count work unchanged. The discount is two Stripe subscription-schedule
phases on the Team subscription (100% off for `freeMonths`, 50% off for `halfPriceMonths`), and seats past `maxSeats`
bill at full price from day one. Unlike the grants below it asks for a card at Checkout, so a startup that stays rolls
straight into paying Team with nothing to redeem. Needs: the application form and its review on `/admin`, a
partner-accelerator code path, and `@aimhuge/billing` support for schedule phases (or a Stripe coupon pair) in
`startCheckout`. The weft.zip pricing section shows it as Coming soon until then.

**Grants** (`lib/billing/grants.ts`). `oss` and `edu` are `GRANT_PLANS` in `lib/billing/plan-gate.ts`, also in `TEAM_PLANS`.
`grantPlan(service, orgId, plan)` writes the workspace's subscription row through `billing.saveSubscription` (no Stripe customer,
`unitAmountCents: 0`, `interval: "yearly"`) and refuses a workspace that pays for Pro or Team. The grant's end is the row's
**`trial_end`**, not its period end: `@aimhuge/billing` rolls any $0 row's period forward on every read (`rollsOnRead`), so
`current_period_end` never runs out. `grantLapsed(plan, trialEnd)` reads a grant past its end (or with none) as Free, which
`workspacePlan` applies, so a lapsed workspace can't invite. `renewDue` is true inside the grant's last 30 days (`RENEW_WITHIN_DAYS`).

**Open Source check** (`lib/billing/oss.ts`, `lib/billing/oss-grant.ts`). `openSourceRepo(login, { token })` lists the
user's public repos (with their GitHub token: `/user/repos` with owner, collaborator and org-member repos; without:
`/users/<login>/repos`), keeps the ones they maintain (owner, or admin/maintain/push), and asks each for `OSS_BAR`:
public, not a fork, not archived, a licence in `OSI_LICENCES` (GitHub's `spdx_id`), pushed within 90 days, and **25 stars
or 20 commits in those 90 days** (picked 2026-10-24) (commit counts are one request each, at most five repos). `checkOpenSource` skips a paying
workspace and a grant with more than a month left, else grants `oss` on a hit. It runs:

- at sign-in: `finishWebSignIn` (`lib/web-auth.ts`) returns `github: { userId, login, token }` from the exchanged session
  (`user_metadata.user_name`, `provider_token`), and `app/auth/callback/route.ts` runs `openSourceAfterSignIn` in `after()`,
  so GitHub's latency never holds up the redirect. The token is used for that request only, never stored. Every failure is
  logged and swallowed: the grant just waits for the next sign-in.
- from the billing page: **Check my GitHub now** (`checkOpenSourceNow` in `lib/billing-actions.ts`, owner or admin), which
  reads the login from `auth.admin.getUserById` and calls GitHub without a token (60 requests an hour per IP).

**Education** has the plan, the gate and `grantPlan(…, "edu")`, but no redemption yet: GitHub gives a pack partner its offer
format (a link with a code, or a coupon list) once the application is accepted, and the redeem route follows that.
The application is the user's step (`~/.weft/show/oss-edu-regional/setup.html`).

**Regional pricing** (`lib/billing/regional.ts`, `lib/billing/regional-pick.ts`). `LOW_INCOME` and `LOWER_MIDDLE_INCOME` are
the World Bank's FY2026 groups from `api.worldbank.org/v2/country` (refresh every July). `regionalPick(service, orgId, ip)`
takes the cheapest tier the IP country (`x-vercel-ip-country`) or the workspace's billing-profile country qualifies for, and
gives the Stripe price variant (`regional_low`, `regional_lower_middle`) and its cents (`REGIONAL_PRO_CENTS`). The billing
page shows the price (`RegionalNote` in `app/[orgSlug]/billing/free-plans.tsx`), and `upgradeToPro` passes
`priceVariant` to `startCheckout` on a monthly upgrade (regional prices are monthly only). It is still plan `pro`, so the meter
and the gate don't change. A VPN gets anyone the price: lost revenue, not lost money, as long as $5 covers a Pro user's tokens.

**Not sold yet: the package.** `@aimhuge/billing` v0.5.0's Stripe provider has one price per plan and interval: it ignores
`priceVariant`, so Checkout sells the full $20, and its webhook maps an unknown price id to no plan. Selling regional Pro needs
the package to read optional `STRIPE_PRICE_<PLAN>_<INTERVAL>_<VARIANT>` prices, use them in `priceIdFor(config, plan,
interval, variant)`, and map them back to their plan in `planForPriceId`; then bump Weft's dependency. Until then the
pricing section marks Regional pricing as coming soon.

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
| `STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOW`, `STRIPE_PRICE_PRO_MONTHLY_REGIONAL_LOWER_MIDDLE` | 🔐 vault (blanks) → Vercel | The $5 and $10 monthly Pro prices. Optional: unset, Checkout sells the full price. Read only once the package has price variants. |
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
- `lib/billing/plan-gate.ts` + `lib/billing/plan-gate.test.ts` — `TEAM_PLANS`, `GRANT_PLANS`, `grantLapsed`, `canHaveMembers`, `workspacePlan`,
  `workspaceCanHaveMembers`: which plans may have members (server-only).
- `lib/billing/grants.ts` — `grantPlan`, `grantEnd`, `renewDue`: the 12-month Open Source and Education grants (server-only).
- `lib/billing/oss.ts` — `OSS_BAR`, `OSI_LICENCES`, `openSourceRepo`: the GitHub read. `lib/billing/oss-grant.ts` — `checkOpenSource`,
  `checkOpenSourceFor`, `openSourceAfterSignIn` (server-only).
- `lib/billing/regional.ts` — the World Bank groups, `regionalTier`; `lib/billing/regional-pick.ts` — `regionalPick` (server-only).
- `app/[orgSlug]/billing/free-plans.tsx` — the billing page's regional note and Open source and education card.
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

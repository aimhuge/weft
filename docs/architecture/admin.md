# Admin (super-admin)

Weft's internal surfaces for the platform team: a paginated list of every
weft.zip account, a local-install snapshot, and the rail entry that exposes
them. Today it's two pages and a guard; future admin work (per-workspace
audit, server-side-cards admin, email-forwarding log) builds on the same
gates.

## Gate

`SUPER_ADMIN_EMAILS` is a comma-separated env on the deployed Weft, read by
`@aimhuge/teams`'s `isSuperAdmin`. The admin gate (`lib/admin.ts`) wraps
`@aimhuge/admin`'s `requireSuperAdmin` and returns the Weft account for the
page to show in the banner. Non-admins see a 404, not a 403 — a 403 would
confirm the route's existence, a 404 is silent.

The check happens in three places:

- **Server gate** (`requireSuperAdminWeft`) — used by `app/(admin)/admin/`
  page components and by `/api/admin/*` route handlers.
- **Client gate** (`useSuperAdminGate`) — used by `components/LibraryRail.tsx`
  to decide whether to render the 🛡 Admin icon. Calls `/api/admin/gate`,
  which runs the same `isAdminWeft` server-side, so the env never reaches
  the bundle.
- **`/api/admin/gate`** — the tiny JSON endpoint the client hook polls.
  Re-evaluates on the `weft:account` window event (sign in, sign out).

## Routes

- `app/api/admin/gate/route.ts` — `{ admin: boolean }`. Read-only, no
  service key, no database calls.
- `app/api/admin/users/route.ts` — paginated `auth.users` joined to
  `profiles`, sorted by `created_at` / `last_sign_in_at` / `email`, searched
  with a `ilike` on email (the wildcard is escaped via
  `@aimhuge/teams`'s `escapeLikeWildcards`). 503 when `SUPABASE_SECRET_KEY`
  is missing (the desktop case).
- `app/api/admin/local/route.ts` — local stats from `~/.weft/`: data dir,
  uptime, board / thread / archived counts, activity log size, last
  activity timestamp, page store size, keep-alive minutes. No service key
  needed.

## Pages

- `app/(admin)/admin/layout.tsx` — full-window layout with a top bar
  (`← Board`, `Users`, `Settings`) so the SuperAdmin can return without the
  browser back button. The bar's small and dark so it doesn't compete with
  the page.
- `app/(admin)/admin/users/page.tsx` — server component, calls
  `requireSuperAdminWeft()`, hands the session to `UsersClient`.
- `app/(admin)/admin/users/UsersClient.tsx` — client component, owns the
  `AdminTablePage` from `@aimhuge/admin` and the fetch loop
  (`/api/admin/users?skip&take&q&sort`).
- `app/(admin)/admin/settings/page.tsx` — server component, calls
  `requireSuperAdminWeft()`, then fetches `/api/admin/local` over loopback
  with the `x-weft-token` header (the same guard every API route uses).

### Billing and coupons

`/admin/billing` and `/admin/coupons` (the header's **Billing** and **Coupons**) are the billing console: one
workspace's plan, seats, refunds, people, discounts and reset, each on the Stripe key for the mode its ids live in,
and the coupon codes and referrals. Their routes (`/api/admin/billing`, `/api/admin/billing/[orgId]`,
`/api/admin/coupons`) gate again in `lib/billing/admin/route-gate.ts`. See billing.md "Admin console" and
"Coupons and referrals".

## Rail

`components/LibraryRail.tsx` adds the 🛡 Admin icon under the others when
`useSuperAdminGate()` returns true, separated by a divider. Clicking it
navigates the board window to `/admin/users` (`window.location.assign`).
Other tools in the rail open a drawer; admin doesn't, because the pages
take over the whole window and a "← Board" link in the layout returns.

## Tokens

`app/globals.css` defines `--admin-bg / --admin-surface / --admin-border /
--admin-text / --admin-muted / --admin-accent / --admin-error`, aliased to
the board's `--canvas / --panel / --line-strong / --ink / --muted /
--accent / --danger` for light and dark themes. The package's
`AdminTablePage` reads them so a SuperAdmin page in Weft looks like the
rest of the board rather than the package's default palette.

## Tests

- `lib/admin.test.ts` — `requireSuperAdminWeft`, `isAdminWeft`,
  `adminServiceClient`, `adminSessionFrom`. Mocks `next/navigation`'s
  `notFound` to throw `NEXT_NOT_FOUND`, mirrors the package's gate.
- `app/api/admin-routes.test.ts` — `/api/admin/gate`, `/api/admin/users`
  (the no-service-key 503, the paginated rows + total, the q-ilter, the
  auth.users / profiles join), `/api/admin/local` (the overview shape).
- `components/LibraryRail.test.tsx` — admin icon shown only when
  `useSuperAdminGate()` is true; the click navigates to `/admin/users`.

## Limitations

- The Users page needs the service-role key. A desktop install without
  `SUPABASE_SECRET_KEY` sees 503 — the page explains why, but the data
  isn't there. A Weft running on the deployed weft.zip has the key.
- The Settings page is local; on the deployed weft it shows the deployed
  server's `~/.weft`, which is the running Vercel function's ephemeral
  filesystem (mostly empty). Use it for the desktop.
- No write paths yet. Read-only is the right starting point — once the
  SuperAdmin can read, the obvious next step is to act (ban an account,
  change a role). Those go through separate routes that mint per-action
  audit rows; the read pages don't grow a sidebar.

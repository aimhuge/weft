# The Growth app

📈 **Growth** is Weft's own data mini app (`~/.weft/apps/growth/`): a page that reads Weft's production
Supabase and GA4 and draws the numbers that say how Weft is actually being used. It is the worked example of
what a data app can be — a folder with a page, a manifest naming its reads by name, and no server code of its
own. How a mini app gets those reads is in mini-apps.md; this doc is about **which numbers Weft counts, and
why**, because the counting rules are where a growth number goes wrong.

Status (2026-10-24): the account-level reads and the in-app reads are both live and applied to production.

## The two questions it answers

**How many people are there, and are they coming back?** Signups per day, accounts over time, active accounts
per day, weekly retention cohorts, the activation funnel (account created → signed in → synced a folder →
shared a card → used the Puku trial → invited a teammate).

**Which version is everyone on?** Accounts per Weft version, each counted once at the version its Mac reported
last, split into release builds and dev mode, with how many of them opened Weft in the last 7 days.

**What do they do inside Weft?** Cards pushed per day, in-app engagement per day, and a second retention table
that counts only real work.

The second set exists because the first set flatters. The original retention counted a **sign-in** as
activity, so an account that opened Weft once and left counted as retained. Opening the app is not the same as
pushing work through it, and the gap between the two tables is the interesting number — an example read off the
app in October 2026 (the live numbers are the app's, not this doc's):

| Signup week | Sign-in retention | In-app retention |
| --- | --- | --- |
| Oct 12 | 67% → 33% | 33% → 33% |
| Oct 19 | 100% | 0% |

## Key files

| File | What it holds |
| --- | --- |
| `~/.weft/apps/growth/index.html` | The page: markup, CSS and plain JS that asks for each read and draws it |
| `~/.weft/apps/growth/weft-app.json` | The manifest: the project folder, the vault env, and every read by name |
| `supabase/migrations/20261018054110_growth_reads.sql` | The account-level reads (`growth_overview`, `growth_signups_by_day`, `growth_active_by_day`, `growth_retention`, `growth_funnel`) |
| `supabase/migrations/20261024041130_growth_in_app_reads.sql` | The in-app reads (`growth_cards_by_day`, `growth_engagement_by_day`, `growth_engagement_overview`, `growth_retention_in_app`) and the two helpers behind them |
| `supabase/migrations/20261029075755_app_versions.sql` | `app_versions`, the Mac's `app_version_submit` and the `growth_versions` read |
| `lib/app-version-sync.ts` | The signed-in Mac's once-a-day version report, on the league sync's timer |
| `~/.weft/app-grants.json` | The grant: the app's folder and env, the vault names its reads need, and the hash of its manifest that voids it when the manifest changes |

## The reads

A read is a Postgres function the page names; the page never sends SQL (mini-apps.md). Every function follows
the project's read-security convention:

```sql
security definer
set search_path = ''
revoke all on function ... from public, anon, authenticated;
grant execute on function ... to service_role;
```

These count **across all accounts**, so the anon and signed-in keys must never call them — the service role is
the only key that can, and only Weft's main process holds it.

### The card helpers

`private.growth_card_days()` flattens `public.cloud_cards.card` — a JSONB blob — into one row per card:
`card_id`, `owner_user`, `created_day`, `moved_day`, `card_column`, `turns`, `added`, `removed`, `folder`.

| Column | From | Note |
| --- | --- | --- |
| `card_id`, `owner_user`, `folder` | the `cloud_cards` row | the account the card belongs to |
| `created_day` | `card->>'createdAt'` | epoch **milliseconds**, converted to a UTC date |
| `moved_day` | `card->>'columnAt'` | when the card last changed column |
| `card_column` | `card->>'column'` | `backlog` / `running` / `needs_you` / `review` / `done` |
| `turns` | `card->>'turns'` | the turns the card has run |
| `added`, `removed` | `card->'stats'->>'added'` / `->>'removed'` | lines changed in the card's folder |

`column` is a reserved word in Postgres's OUT-parameter list, so the column is named **`card_column`**. The
name reads oddly in SQL (`where card_column = 'done'`) and that is the price.

`private.growth_engagement_activity(since timestamptz)` is the other helper: the days an account did **real
work**. A card pushed (its `created_day`), a card moved (its `moved_day`), or a turn run — a row in
`public.cloud_thread_items` with `kind in ('assistant','user')`, joined back to `cloud_cards` for `owner_user`.
This is the definition the in-app retention and the engagement counts both use.

### The four in-app reads

- **`growth_cards_by_day(days)`** → `(day, created, moved, accounts, done)` — cards created against cards
  moved, and how many reached Done.
- **`growth_engagement_by_day(days)`** → `(day, accounts, cards, created, turns, items)` — the cards people
  touched against the cards they started, plus the accounts working and the turns they ran.
- **`growth_engagement_overview()`** → a jsonb object: `cards_30d`, `pushers_30d`, `cards_per_pushers`,
  `moved_30d`, `done_30d`, `cards_all`, `turns_30d`, `engaged_accounts`, `accounts`. A jsonb function's body
  **is** the object; a table function's body is an array of rows, and the page has to tell them apart.
- **`growth_retention_in_app(weeks)`** → `(cohort, size, week, retained)` — the same weekly cohorts as
  `growth_retention`, but "retained" means the account did real work that week.

### Versions

Nothing recorded an install's version before 0.6.7: the updater reads `update.json` straight from GitHub, so
Weft never sees a check, and every `auth.sessions.user_agent` is just `node`. Now the signed-in Mac calls
`app_version_submit(version, channel, platform)` once a UTC day (`lib/app-version-sync.ts`, on the league
sync's timer), as the caller only: one `app_versions` row per account, version and channel, with `first_at`
and `last_at`. `channel` is `release` for a packaged build (`NODE_ENV=production`) and `dev` for
`pnpm desktop` from a checkout, whose `package.json` version can run ahead of the latest release.

- **`growth_versions(days)`** → `(version, channel, accounts, active_7d, first_at, last_at)`: each account
  counted once, at the version it reported most recently within `days`; newest version first by its numbers
  (`0.10.0` above `0.9.0`).

It counts only signed-in Macs on a build that reports, so the panel starts empty and fills as people update.
The **Versions** panel lists each version with its accounts and how many opened Weft this week. Rows come
newest first and a dev checkout can run ahead of the release, so "latest" marks the first `release` row, not
the top one; "latest" and "dev" are words in the row, not colours.
Downloads per release on GitHub (`.zip` is mostly Squirrel's auto-update, `.dmg` a fresh install) are the
only signal for older builds.

## Patterns and gotchas

**A function's return type cannot be altered in place.** Postgres refuses `create or replace` when the row
type changes. `growth_engagement_by_day` gained a `created` column, so the file carries

```sql
drop function if exists public.growth_engagement_by_day(int);
create or replace function public.growth_engagement_by_day(days int default 30) ...
```

before the replacement. A migration that changes a return type must drop first, and the drop is inside the
same transaction as the create — a failed apply leaves neither.

**Two scales on one axis is a bug, not a style.** Turns run into the thousands and cards into the hundreds, so
a chart with both on one axis flattens the cards to nothing. Each chart keeps a card-scale series and pushes
turns into the hover tooltip. This is why the engagement panel plots cards touched and cards created, and not
turns.

**Nothing reads by colour alone.** The two-series charts carry a text legend; the cohort tables always print
the number in the cell (`33%` over `1/3`), so the share survives a greyscale print and a colour-blind reader.

**The last day is hatched.** A day that is not over yet is drawn with a hatch pattern
(`url(#hatch)`, defined per chart) instead of a solid bar, so a partial day doesn't read as a real drop.

**The grant voids when the manifest changes.** Adding a read changes the manifest's hash, and the grant that
carried the old hash is void (`electron/app-data-grants.cjs`). If the change only adds read names and reuses
an env the grant already holds, the user can recompute the hash and write it into `~/.weft/app-grants.json`
rather than grant again with Touch ID. A thread can't: `app-grants.json` stays sealed to threads even though
`~/.weft/apps/` is open (docs/architecture/secrets.md), so a thread that adds a read says Growth will ask for
Touch ID once.

**Cloud sync is opt-in per folder, so the counts undercount.** The in-app reads read the **synced** rows
(`cloud_cards`, `cloud_thread_items`). Work done in a folder that isn't syncing to weft.zip is invisible to
them, exactly as it is to the account-level reads. Every panel that reads the synced rows says so.

## The page

Plain HTML, CSS and JS in one file — no build step, no framework. The pieces that matter:

- **`window.weft`** is the bridge (`electron/pane-preload.cjs`): `read(name, args)` runs a named read and
  gives back `{ rows }`. It must be taken as `const bridge = window.weft`; a top-level `const weft` collides
  with the non-configurable global that `contextBridge` installs, and the browser then refuses the whole script.
- **`drawRetention(host, rows)`** draws both retention tables from the same code, so they can't drift apart.
- **`stacked(host, points)`** draws the stacked bars, the legend and the hatch pattern.
- **`PANEL_IDS`** lists every panel's div id, used by both `load()` and `blank()`, so a panel can't be added to
  one and forgotten in the other.

Every `get("…")` name in the page must exist in the manifest, and every manifest read must be used — a
mismatch in either direction is a broken panel or a grant for nothing.

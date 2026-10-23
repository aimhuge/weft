# Public profiles

Every Weft account has a public page at `weft.zip/@username`. Anyone can open it without signing in.

## What it shows

- The picture and name from your GitHub sign-in (`profiles.avatar_url`, `profiles.name`), or the first letter of your username when there's no picture.
- `@username` and **Wefter since** (the month your account was created).
- A **GitHub** link, to the login you signed in with (read from Auth's `user_metadata.user_name`, since the username may carry a `-2` or come from your email).
- **The builder card**: what the Loom's "You" and "Badges" tabs show, from the card your Mac last posted (below): your
  picture in a ring that fills toward the next level with an `Lv N` chip, your class and level title, your GitHub bio,
  location, company, site, followers and repos, the XP bar, big numbers (XP, cards shipped of started, streak with best
  and freezes, badges earned of all), the attribute radar and bars with their hints, skills, the activity cloth (26
  weeks, a `<title>` per stitch), a wall of earned badges with the day each was earned, tokens per day for 30 days with
  plan-limit dots, and records (biggest day, most shipped, fastest ship, most at once). "Synced from Weft N min ago"
  closes the page. Before a Mac has posted, a note says the card shows up once they open Weft signed in.
- **League**: this week's (the latest) league and rank in it, from `league_weeks` (the tier's name, `#rank of size`, XP).
- **Mini apps**: up to 12 of your mini app links set to *public* (`cloud_app_shares`), each to its `/a/<id>`.
- **Public threads**: up to 24 of your share links set to *public* (`cloud_shares.mode = 'public'`, `created_by` = you), newest first, each a link to its `/s/<id>` viewer. A link whose card was deleted is left out.

It never shows your email, your workspace, a project's name, a card's folder or any private, email or password share.
The Loom's Projects tab (each project's production-ready tree) stays on the Mac for that reason.

## The builder card

`lib/profile-card.ts` `profileCard(game, github)` cuts the Loom's `GameState` (`lib/game-server.ts`) and the `gh` profile
down to what the page draws: no project roots, no `today`, only unlocked badges. `lib/profile-card-sync.ts` posts it with
`profile_card_submit(p_card)` (`supabase/migrations/20261018135430_profile_cards.sql`: one row per account in
`profile_cards`, no policies, a security definer function that writes only the caller's row, 64 KB cap), on the league
sync's 10-minute timer (`lib/league-sync.ts` `startLeagueSync`) while you're signed in; the same card twice in a row isn't
posted again, and a missing function (`PGRST202`) waits quietly. Anyone signed in can post any JSON as themselves, so
`loadPublicProfile` runs the row through `parseProfileCard`, which keeps only known fields, clamps numbers, cuts strings,
checks day keys and GitHub logins, and keeps only http(s) links. The page is server components only
(`components/profile/PublicProfileView.tsx`, `ProfileHero.tsx`, `ProfileSections.tsx`, `ProfileCharts.tsx`, plain SVG
charts) on `profile.css` and `profile-card.css`, so it ships no JS.

## Usernames

`supabase/migrations/20261018133008_profile_usernames.sql` adds `profiles.username`: unique, lowercase, shaped like a GitHub
login (`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`). `private.username_for(seed)` slugifies the GitHub login (or the email's local
part), skips a short reserved list (`admin`, `weft`, `support`…) and adds `-2`, `-3`… on a clash. The trigger
`on_auth_user_created_username` sets it after the profile row exists (triggers fire in name order). Accounts made before the
migration were backfilled oldest first, so the earliest sign-up keeps the bare login. Usernames can't be changed yet.

## Route

An App Router folder can't start with `@`, because that marks a parallel-route slot. So `next.config.ts` rewrites `/@:username` to
`/u/:username` in `beforeFiles`, ahead of the `[orgSlug]` segment. `/u/<username>` works too. A workspace can never be named `u`,
because `private.org_slug_for` skips slugs shorter than 2 characters.

`app/u/[username]/page.tsx` awaits its params inside a `<Suspense>` (cacheComponents) and calls `loadPublicProfile`
(`lib/public-profile.ts`). That reads through the service client, since `profiles` has no anon policy, selects only the public
columns, and returns `null` (so the page 404s) for a handle that can't be a username or isn't taken. A handle like `@Alex` or `%40alex` is lowercased first, so a link
built from a GitHub login with capitals (the league standings' `username`) still lands. The body is `components/profile/PublicProfileView.tsx`, a server component on
`team.css`'s tokens plus `components/profile/profile.css`. Off weft.zip (`isDeployed()` false), the page shows a note instead. While it loads the page shows `ProfileSkeleton`, and a missing handle
the site's not-found page ([web-states.md](web-states.md)).

## Not yet

- Editing your username or adding a bio.
- An opt-out (a profile is always public, and so is its builder card), and an opt-out for listing a public share.
- A per-profile `<title>` and Open Graph image: the metadata is static, like `/s/[id]`'s.
- A link from the workspace header or the desktop's account menu to your own profile.

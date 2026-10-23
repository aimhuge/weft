# Sharing a card

Status: built 2026-10-17; needs the `cloud_shares` migration applied and `SHARE_GATE_SECRET` on Vercel.

**Share…** on a card's right-click menu (⇧S), or the share icon in the browser pane's toolbar beside ☆ and Archive (`components/PaneCardMarks.tsx`; in the thread header when the pane is closed), gives one link, `weft.zip/s/<id>`, that shows the card's thread on the left and
the page its browser pane shows on the right, live, to whoever the link is for. Its access modes, dialog, unlock form,
pass cookie and password hashing come from `@aimhuge/share` (aimhuge/components, the same package DeckCP's deck sharing
was extracted into). Weft brings the resource (a card), its storage and its routes.

Sharing reads what cloud sync (cloud-sync.md) already uploads, so a card is shared only from a synced folder; the dialog
offers to turn sync on for it.

## Modes

The package's modes, minus one: a card never takes `public_edit`, because editing a thread would mean sending a turn
that runs on the owner's Mac (`CardShareMode`, `isCardShareMode` in `lib/share-types.ts`; the dialog passes
`allowEdit={false}`).

| Mode | Who gets in |
|---|---|
| `private` | Signed-in members of the card's workspace (the same people the web board shows it to). The row and its id stay, so opening it up again reuses the link. |
| `public` | Anyone with the link. |
| `email` | Anyone with the link who gives an email; each one lands in `cloud_share_visits`. |
| `password` | Anyone with the link and the password. Only its scrypt hash leaves the Mac. |

Passing a gate sets a signed, httpOnly pass cookie for that share (`lib/share-gate.ts`, `createShareGate` with the
`weft_share_` prefix), good for 30 days. With no `SHARE_GATE_SECRET` in production the gate mints and accepts nothing:
gated links answer "Sharing isn't set up on this server" rather than trusting a published constant.

## The parts

- `lib/share-types.ts`: the contract. Row shapes, `newShareId` (16 random bytes, base64url), `shareUrl`, the desktop's
  `CardShareState`, the viewer's `ShareLive`, and `paneFor` / `paneFromUrl`, which pick the pane from the thread.
- Desktop: `lib/card-share.ts` + `app/api/cards/[id]/share` (GET/PUT) read and write the card's `cloud_shares` row through
  the signed-in account, in the workspace cloud sync uploads to. The states: `signed-out`, `no-workspace`, `not-synced`
  (with the folder), `pending` (the card's `cloud_cards` row isn't up yet, so a flush is asked for), `ok`.
  `components/ShareCardDialog.tsx` is the package's `ShareDialog` + `ShareAccessFields` + `CopyLinkButton` over
  `useShareAccess`, opened from **Share…** in `lib/card-menu.ts`. It never shows a loading state: the state read takes
  a few Supabase round-trips (~2 s), so the dialog draws at once from `card.share` (the last answer, kept on the card by
  `lib/card-share.ts`, through `seedShareState`; private when there's none, the sign-in when signed out) and the answer replaces it.
- Deployed: `app/s/[id]/page.tsx` loads the share with the service client (`lib/share-access.ts`), decides
  ok / gate / login / denied / missing, and renders `ShareGateForm` or `components/share-view/SharedCard.tsx`.
  `app/api/s/[id]/unlock` checks a password or records an email, then grants the pass. `app/api/s/[id]/live` is the
  viewer's poll (`lib/share-live.ts`); `app/api/s/[id]/page/[sha]` serves an uploaded page.

## The pane

The thread already records what the pane showed: each `mcp__browser__open_url` call's `summary` is the URL, and each
message you send carries the page on screen (`page`, `lib/pane-page.ts`). `paneFor` takes the newest of those, across
the whole thread, as one of three kinds:

- `blob`: a local file, usually a `~/.weft/show` page. The outbox uploads it like any other blob and writes
  `blob:sha256:<hex>#anchor` into the uploaded copy (`lib/blob-store.ts`). The viewer frames
  `/api/s/<id>/page/<sha>#anchor`, which serves it with `Content-Security-Policy: sandbox allow-scripts allow-popups allow-forms`:
  the page runs, but in an opaque origin, so its scripts can never read weft.zip's cookies.
  The route serves only the blob of this card's own current pane (`loadPaneAcrossThread`), never another upload in the
  workspace, and masks key-shaped text in what it serves, the way the thread is.
  The type comes from the file, not from Storage, which answers HTML as `text/plain` (`lib/share-page.ts`; bug-fixes/022).
- `site`: a public URL, framed directly, with an Open link for the sites that refuse to be framed. Both frames go through
  `components/share-view/PaneFrame.tsx`, which shows loading and "This page didn't load" states ([web-states.md](web-states.md)).
- `local`: only reachable on the owner's Mac (localhost, a file that didn't upload). The viewer shows the card's pane
  capture instead: the thumbnail `lib/show.ts` takes after each turn, which the outbox now uploads as a blob too.

## Live

Visitors aren't workspace members, so they can't use Realtime under RLS. The viewer polls `/api/s/<id>/live?after=<seq>`
every 4 s (`SHARE_POLL_MS`) while its tab is visible. Every poll re-checks access (the pass cookie, the mode, a deleted
card) and returns new items newest first, the card, the pane and hour-long signed URLs for every blob they use. Items
merge by seq, so one that changed in place is replaced. `?before=<seq>` pages back for "Load earlier messages".

## What a viewer never gets

- The rest of the card: the viewer gets `id`, `title`, `emoji`, `column`, `tags` and an uploaded `thumb` (`toShareCard`, `ShareCard`),
  never its folder, session id, pending question or task command lines; a `local` pane keeps its label but not its address
  (`publicPane`).
- Key-shaped text: every string in every item goes through `lib/share-redact.ts`, which replaces what
  `lib/secret-detect.ts` finds with `‹hidden: <kind>›`, then a second pass
  (`lib/share-redact-entropy.ts`) flags any 40+ char run whose Shannon entropy is above 4.7 bits/char
  and isn't a known safe shape (UUID, hex hash, ULID, Snowflake) — a custom in-house API key, a
  freshly minted one-off, an internal SaaS token — and replaces it with `‹hidden: an opaque value›`.
- Long tool outputs: an output over 2 KB is cut from the item by cloud sync anyway, and the viewer's tool-result
  source answers "Long output isn't shared." instead of fetching it from `cloud_tool_outputs`.
- The password hash: `authenticated` can't select `cloud_shares.password_hash` (column grants); clients read
  `has_password`.

## Schema

`supabase/migrations/20261017074157_card_shares.sql`:

- `cloud_shares`: one row per shared card (`unique (org_id, card_id)`, a foreign key to `cloud_cards` that cascades),
  `id`, `mode`, `password_hash`, generated `has_password`, `created_by`. Members read; only the card's owner
  (`private.is_card_owner`) writes.
- `cloud_share_visits`: `share_id`, `email`, `at`. Written by the deployed Weft with the service role; the card's owner reads.

## Rate limit

`POST /api/s/[id]/unlock` answers a share gate's password or email; the route itself is open. A
per-(ip, share_id) cap of 10 attempts per 10 minutes lives in Supabase, not in the route's
memory, so a Vercel redeploy or a new instance doesn't reset it.

- `share_unlock_attempts` (one row per (ip_hash, share_id); `20261018120000_share_unlock_attempts.sql`):
  `ip_hash`, `share_id`, `count`, `first_at`. RLS off; only the service role reads or writes.
- `ip_hash` is `SHA-256(ip || SHARE_UNLOCK_PEPPER)` (`lib/share-unlock-rate.ts` `hashIp`), so two
  Weft deployments don't share a bucket space and a stolen DB row can't be matched back to a
  viewer without the pepper. The route reads the real remote address off `x-real-ip` (set by
  Vercel at the edge), not the `x-forwarded-for` chain, which a client can forge.
- One round trip per attempt: `checkAndRecord` calls `public.share_unlock_bump`
  (`20261018045842_share_unlock_bump.sql`), a single `INSERT … ON CONFLICT DO UPDATE` that rolls the
  window (count back to 1, `first_at` to now) or bumps `count`, capped at max + 1, under the row lock.
  Racing attempts on one bucket queue on the row, so at most 10 get through (the first version read
  then updated in two trips and could let a burst past; pentest 2026-10-18, F-2). Over the limit
  answers 429 with a `Retry-After` set to the seconds until the row's `first_at` ages out. Fails
  open on a Supabase error so a rate-limit outage doesn't lock out share visitors.
- The route answers 503 anywhere `VERCEL` isn't set (F-6): off Vercel nothing rewrites `x-real-ip`,
  so a caller could pick a fresh bucket per request. It also 503s with no service key.

## Sharing a mini app

A mini app's **Share…** uses the same dialog frame, modes, gate, pass cookie and sandboxed page serving for a
`weft.zip/a/<id>` link, from its own `cloud_app_shares` table, since a mini app lives on the Mac rather than in cloud
sync: mini-apps.md has the rest. `gateVerdict` (`lib/share-access.ts`), `lib/share-page-serve.ts` and
`lib/share-unlock.ts` are the shared parts.

## Sharing the board

**Share the board** (the share icon beside the avatar and its menu in `components/AccountButton.tsx`, and ⌘K's `share-board` command in
`components/board-palette.ts`) opens `components/ShareBoardDialog.tsx` in the same `@aimhuge/share` frame. Its body,
`components/BoardSharePanel.tsx`, is shared with the weft.zip board: **Share** in its header
(`components/web-board/WebShareBoard.tsx`) opens the same panel on the visitor's cookie session, loading the team when the
dialog opens through the `boardShareTeam` server action (`lib/team-actions.ts`, behind the team page's gate) and inviting
through the team page's actions (`components/team/web-actions.ts`), then reloading the list. There is no share
row: the web board (`app/[orgSlug]/board`) already shows a workspace's synced cards to its members, so the link is
`weft.zip/<slug>/board` and sharing it means adding people to the workspace. The dialog reads the team through
`lib/use-team.ts` (prefetched by the top bar), lists members and pending invites, and its email box calls the same
`invite` op as Settings → Team, which weft.zip's `runInvite` (`lib/team-ops.ts`) answers: an address with a profile joins
at once ("Added …"), one without gets an invite email (`createInvite` + `inviteMailer`) to sign up and join. It invites as
Member (or the first role the viewer may hand out); members who can't manage the team see the link and the list only. Signed
out, it asks you to sign in first, like Share…. A workspace switcher shows when you're in more than one.

## Gaps

- An invitee lands on `/<slug>/team?joined=1` after accepting, not on the board they were shared.

- Item bodies are plain JSON on Supabase (cloud-sync.md's gap), and a public link puts them in front of anyone with it.
  Redaction catches known key shapes, not everything a tool printed.
- An uploaded page still points at its images by local relative paths, so a show page's own pictures don't load remotely.
- No per-share expiry or revoke-all; making a card private, or deleting it, is how a link stops working.
- The owner can't see the visits list in the app yet.

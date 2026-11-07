# Mobile

The Weft phone app is a React Native (Expo) app in `~/dev/weft-mobile`. It signs in to the same Supabase project as
weft.zip and reads the synced board (`cloud_cards`, cloud-sync.md). This doc holds the server side Weft keeps for it;
the app's own sections (screens, sign-in, the feed) live beside it.

## The app

`~/dev/weft-mobile` (its own repo; Expo SDK 58, React Native 0.88, expo-router). The design: **the pane is the app**.
No chat on the main screen; each card is the page its agent last showed, full screen, because every turn leaves one
(SOUL: "always showing you something"). The thread is one tap away.

```
┌──────────────────────────┐  header: title, column · stage · "2 of 7"
│ 💳 Stripe checkout     ＋ │  swipe ↑↓ here = next/previous card, tap = the card list
├──────────────────────────┤
│                          │
│   the card's pane page   │  WebView: blob page via /api/web-board/<org>/page/<sha>
│   (scrolls normally)     │  with Authorization: Bearer <jwt>; https site as itself;
│                          │  localhost = the pane capture (card.thumb) as a still
├──────────────────────────┤
│ ● ● ● ━ ●                │  pane history: swipe ←→ on this bar, or tap a dot
│ 💬 last sentence         │  subtitle (status lines stripped)
│ [Monthly] [Yearly]       │  card.pending → answer / Allow (Face ID) / Deny
│ [ Reply…          ] 🎙 ■ │  hold to talk (on-device speech), Stop while running
└──────────────────────────┘
```

- **What it reads**: `cloud_cards` where `owner_user` is you (every workspace), live over Realtime; per open card,
  `cloud_thread_items` for the newest 60 items (subtitle, transcript) and every `mcp__browser__open_url` tool item
  (`kind = 'tool'`, `item->>name`), whose `summary` is the page (`blob:sha256:<hex>#anchor`, an https URL, or
  localhost). It also reads `card.page` when the phone-readable-pages work adds it.
- **What it writes**: only `cloud_commands` rows (`reply`, `answer`, `stop`, `new_card`) in `lib/cloud-commands.ts`'s
  shapes, and its own `push_devices` row. An `answer` with `allow: false` and `reply.chat` is "Chat about this".
- **Sign-in**: Supabase OAuth (GitHub only) with PKCE in the system auth sheet, redirect `weft://auth/callback`,
  which must be in the project's Auth redirect allow list.
- **Bearer routes**: `lib/web-session.ts` `requestSession(req)` gives a route the caller's RLS-scoped client from
  `Authorization: Bearer <jwt>` (the phone) or the cookie (weft.zip). `/api/web-board/[orgId]/page/[sha]` and
  `/blob-urls` use it, so the phone loads pages and signs pane captures the way the web board does.

## TestFlight

Getting people onto the phone app: a one-time **Weft on your phone** prompt on the desktop board shows the external beta
group's public TestFlight link as a QR code, with **Email me an invite**, which adds the signed-in account's email to the
group through the App Store Connect API (Apple sends the invite). Pair a phone (Settings → Sync) has the same link as
"No Weft app on your phone yet? Get it on TestFlight".

```
PhonePrompt (HeaderBadges)  ──GET/POST──▶ /api/account/testflight (localhost, guard)
                                              │ lib/testflight-client.ts, Bearer <account access token>
                                              ▼
                                   weft.zip /api/testflight      GET: { url, invites }  (public)
                                              │ POST: email from bearerUser(req), never the body
                                              ▼
                                   lib/testflight.ts inviteTester: ES256 JWT (ascToken) →
                                   POST /v1/betaTesters {email, name, betaGroups:[group]}
                                   409 (already in the account) → GET ?filter[email] → add to the group
```

- **When it shows** (`lib/phone-prompt.ts` `shouldOfferPhone`): signed in, welcomed, three threads finished, no phone in
  `push_devices` yet, the sync ask didn't open this launch, weft.zip answers with a link, and `weft-phone-prompt-seen`
  isn't set in localStorage. Closing it either way sets that flag; Settings → General → Reset tips clears it.
- **Dormant until set up**: with no `TESTFLIGHT_PUBLIC_URL` on weft.zip, GET answers `url: null` and nothing shows; with
  the link but no key, the prompt shows the QR code without the email button.
- **weft.zip env** (`.env.example`, the 🔐 vault's production blanks): `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`
  (the .p8, newlines or `\n` escapes), `TESTFLIGHT_GROUP_ID`, `TESTFLIGHT_PUBLIC_URL` (`https://testflight.apple.com/join/…`
  only). The key needs the App Manager or Admin role; a Developer key (the notarization one may be) can't add testers.
- **Apple's side**: the group must be external with a build that passed Beta App Review, or invites wait for one.
  External testing caps at 10,000 testers. "This beta isn't accepting any new testers" on the join link means the group has
  no approved build: Beta App Review rejected build 4 under Guideline 2.1(a) because the app only offered GitHub OAuth,
  so the reviewer had no way in.
- **App Review account**: the phone's sign-in screen has a small "Sign in with email" link (`signInWithEmail` in
  weft-mobile `src/lib/auth.ts`) for accounts made by hand. `appreview@weft.zip` is such a user in the prod Supabase
  project, with its own "App Review" workspace and four seeded `cloud_cards` (and their `cloud_thread_items`) so the feed
  isn't empty. Its credentials live in the 🔐 vault as `APP_REVIEW_EMAIL` and `APP_REVIEW_PASSWORD` (production) and in
  App Store Connect → TestFlight → Test Information → Sign-in required, with Review Notes that point at the email link.
  A build needs that filled in before it goes to Beta App Review.

## Push

A phone buzzes when one of your synced cards moves into **Needs you** or **Review**, whichever Mac (or the web board)
moved it: the trigger runs in the database, not on a Mac.

```
Mac outbox ──upsert──▶ public.cloud_cards
                          │ after update of card
                          ▼
              private.push_on_card_column()   column changed into needs_you/review?
                          │                   moved in the last hour? not pushed for it in 10 min?
                          │ pg_net POST { org_id, card_id, column }  + x-weft-push-secret
                          ▼
              Edge Function push-card         checks the secret (public.push_hook_ok),
                          │                   rereads the card, still in that column?
                          ▼
              https://exp.host/--/api/v2/push/send  → every push_devices row of the card's owner
                          │
                          ▼  tickets: DeviceNotRegistered → delete that row
```

### The table

`public.push_devices` (`supabase/migrations/20261029104224_push_devices.sql`), one row per phone:

| column | type | |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid → `auth.users` | defaults to `auth.uid()`, cascade on delete |
| `expo_token` | text, unique, not null | `ExponentPushToken[…]` or `ExpoPushToken[…]` |
| `platform` | text | `ios` or `android` |
| `device_name` | text, ≤ 120 | what Settings → Sync → Phones shows |
| `created_at`, `last_seen_at` | timestamptz | |

RLS: a signed-in user selects, inserts, updates and deletes only rows where `user_id = auth.uid()`.

**Registering (the phone app).** Call the RPC at every launch while signed in, not a plain insert:

```ts
await supabase.rpc("register_push_device", { p_expo_token: token, p_platform: "ios", p_device_name: Device.deviceName });
```

It upserts on `expo_token`, bumps `last_seen_at`, and moves the token to whoever is signed in now (a phone that
changes accounts would otherwise trip the unique constraint on a row RLS hides). On sign-out, delete your row
(`from("push_devices").delete().eq("expo_token", token)`).

### The push

Built by `supabase/functions/push-card/message.ts` (pure, tested by `message.test.ts`), sent by `index.ts`:

```json
{
  "to": "ExponentPushToken[…]",
  "title": "<card title>",
  "body": "<see below>",
  "data": { "cardId": "<card id>", "org": "<org slug>", "orgId": "<org uuid>", "column": "needs_you" },
  "sound": "default",
  "priority": "high",
  "categoryId": "needs_you"
}
```

- **body**: in Review, `Ready for review`. In Needs you: the first question the thread asked (`pending.questions`),
  else `Asks you to choose` / the form's title for an MCP form, else `Wants to run <pending.title or toolName>` for a
  held tool, else the card's BOARD STATUS `remaining`, its last line, or `Needs you`. Clipped to 178 characters.
- **categoryId** `needs_you` only when the card holds a prompt (`card.pending`): the app registers that iOS category
  with its Approve / Answer actions. A plain Needs you (a question in prose) just opens the card.
- **data** is what the app deep-links on: `org` is the workspace slug, as in `weft.zip/<org>/board`.

### Debounce and staleness

- Only a column **change** fires (`old.card->>'column'` differs); the many upserts a running card gets don't.
- `private.push_card_state` keeps the last column pushed per card. The same column again within 10 minutes is
  dropped, so a card flapping Review → Running → Review buzzes once. A different column pushes right away.
- A move whose `card.columnAt` is over an hour old (an outbox catching up after a Mac was offline) is dropped.
- The function rereads the row and skips if the card has already left that column.
- The `net.http_post` is wrapped so a push can never fail the sync's upsert.

### Secrets

- The trigger reads the function url and a shared secret from Supabase Vault (`push_hook_url`, `push_hook_secret`).
  With either missing it does nothing. They are set once per project, outside git:

  ```sql
  select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_hook_secret');
  select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-card', 'push_hook_url');
  ```

  The function never holds the secret itself: it asks `public.push_hook_ok(secret)` (service role only).
- `push-card` is deployed with `verify_jwt` off (the caller is the database), so the secret is its only check.
- `EXPO_ACCESS_TOKEN` (optional, in the 🔐 vault as a blank): needed only once Expo's enhanced push security is on;
  set it as an Edge Function secret for `push-card`.

### Desktop: Settings → Sync → Phones

`components/PhoneSettings.tsx` (mounted in `SyncSettings.tsx` when signed in) lists your rows, newest seen first,
with **Remove**. It reads through `lib/use-push-devices.ts` → `GET /api/push-devices`, removes with
`DELETE /api/push-devices?id=`, and the route calls `lib/push-devices.ts` with the account's client, so RLS is the
check. Phones pair themselves; there is nothing to add from the desktop.

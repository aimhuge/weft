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
- **Sign-in**: Supabase OAuth (GitHub, Google) with PKCE in the system auth sheet, redirect `weft://auth/callback`,
  which must be in the project's Auth redirect allow list.
- **Bearer routes**: `lib/web-session.ts` `requestSession(req)` gives a route the caller's RLS-scoped client from
  `Authorization: Bearer <jwt>` (the phone) or the cookie (weft.zip). `/api/web-board/[orgId]/page/[sha]` and
  `/blob-urls` use it, so the phone loads pages and signs pane captures the way the web board does.

# BlastCP drawer

BlastCP's rocket logo on the left rail (`components/BlastcpLogo.tsx`, from `rocket-180.png` in the BlastCP repo's brand folder), under 🔐 and ▲, opens a drawer showing the [BlastCP](https://blastcp.com) property each board
project posts as, and what that property has queued. BlastCP is a posting queue (LinkedIn, Substack, Threads,
Instagram, YouTube, email…); a property is one brand you post as, inside a workspace.

## Pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Sign-in | `electron/blastcp-oauth.cjs` | OAuth 2.1 + PKCE against blastcp.com, like an MCP client |
| Main side | `electron/blastcp.cjs` | Keeps the token sealed (its read/persist is the shared `electron/provider-token.cjs`), calls BlastCP's MCP tools, keeps the links; IPC to the board window only |
| Bridge | `electron/preload.cjs` → `window.weft.blastcp` | `status`, `connect`, `forget`, `workspaces`, `link`, `createProperty`, `unlink` |
| View | `lib/blastcp-view.ts` | Types, the queue at a glance, the property picker's order, the rail hover text |
| Hook | `lib/use-blastcp.ts` | Loads status only while the drawer is open (and on window focus, at most every 30s); opens on the cached last status (`lib/use-linked-status.ts`) |
| Drawer | `components/BlastcpDrawer.tsx`, wired in `components/LibraryRail.tsx` | Connect, the queue; linked folders on the shared `components/FolderRow.tsx` |
| Weft connect | `lib/blastcp-auto.ts` + `app/api/blastcp` + `connectWeft` / `exchangeWeft` | Your Weft account's sign-in swapped for a BlastCP one, below |
| Picker | `components/BlastcpPicker.tsx` (on the shared `components/DbSelect.tsx`, fed by `lib/blastcp-view.ts` `propertyOptions`) | Link a property, or make a new one and link it |

## Connecting

```
Connect ─► main: listen on 127.0.0.1:<free port>/callback
        ─► POST blastcp.com/api/oauth/register  {client_name: "Weft", redirect_uris: [that loopback]}
        ─► open blastcp.com/api/oauth/authorize?…code_challenge (S256)&state  in your browser
you sign in + approve ─► BlastCP redirects to the loopback with ?code&state
        ─► POST /api/oauth/token (code + verifier) ─► access token
        ─► whoami, then safeStorage-seal the token into ~/.weft/blastcp-token.json (0600)
```

- BlastCP matches redirect URIs exactly, and the loopback port changes each time, so Weft registers a fresh public
  client on every Connect. Registration is open (MCP's dynamic client registration), and a client can't do
  anything until you approve it.
- Browser sign-ins last **30 days and can't be refreshed** (BlastCP only grants `authorization_code`). The drawer says
  "Sign-in runs out in N days" in the last week and offers **Reconnect**; a refused token shows the Connect form
  again with BlastCP's reason. Settings → Security repeats the same note in its **Sign-in expiry** row
  (`components/TokenExpiry.tsx`), so a lapsing sign-in is found in Settings rather than when a thread trips over it;
  it reuses this drawer's `expiryNote()` and the `expiresAt` main already sends over the bridge, so only the expiry
  crosses from main — the token stays sealed. Vercel, Supabase and Cloudflare tokens don't expire and are listed as
  "No expiry". Nothing re-consents quietly: with no refresh token, re-consenting behind the user's back would be worse
  than saying it's nearly time.
- Connect waits 5 minutes for the browser, and only one runs at a time.
- Main keeps the code it launched with, while the board window hot-reloads. So a Weft started before BlastCP
  landed answers "No handler registered for 'blastcp:…'", and the drawer shows **Restart Weft** instead of that
  error (`components/BlastcpConnect.tsx`, `needsRestart` and `restartWeft` in `lib/blastcp-view.ts`). The button
  sends the startup screen's `splash:action` "relaunch"; a main from before that action ignores it, so the drawer
  sends "quit" 1.5s later and you open Weft again yourself.

## Connecting with your Weft account

Built 2026-10-23. A Weft user signed in to Weft gets a BlastCP account and a connected drawer with no browser and
nothing to click. BlastCP trusts a signed-in Weft session: Weft's Supabase signs access tokens with ES256 and
publishes the keys at its project's JWKS endpoint (`…/auth/v1/.well-known/jwks.json`, alongside the issuer BlastCP
allowlists), so BlastCP can check one without a shared secret. Nothing in this repo names the project: the URL is
environment config, and the keys are BlastCP's to fetch.

```
Weft server (lib/blastcp-auto.ts)            once per Next server process (from lib/copilot.ts prewarm): once
                                              at start, again on every SIGNED_IN, every 12 h (CHECK_MS), and from the
                                              drawer's Connect with Weft (POST /api/blastcp → the same call, force)
  └─ getSession() → access token (supabase-js refreshes it here, so main never races a refresh)
  └─ POST control server /blastcp/connect-weft { subjectToken, force }   (electron/pane-routes.cjs)
Electron main (electron/blastcp.cjs connectWeft → blastcp-oauth.cjs exchangeWeft)
  └─ POST blastcp.com/api/oauth/token   (the same endpoint, the browser's grant_type swapped)
       grant_type=urn:ietf:params:oauth:grant-type:token-exchange   (RFC 8693)
       subject_token=<Weft JWT>  subject_token_type=urn:ietf:params:oauth:token-type:jwt
       client_id=weft  scope=blastcp:all  resource=https://blastcp.com/api/mcp
BlastCP: verify against Weft's JWKS, find identity_links('weft', sub) or make the user and its workspace,
         mint the same 30-day MCP token the browser sign-in gets
  └─ 200 { access_token, expires_in, created }    → whoami, sealed like any sign-in, clientId "weft"
  └─ 400 link_required + link_url                → state "link": that email already has a BlastCP account;
                                                    the connect form keeps showing "Confirm it's you on BlastCP"
                                                    until a sign-in lands, then clears
  └─ 400 unsupported_grant_type / invalid_client → null → "unavailable": a BlastCP without the grant yet, quietly
  └─ anything else                               → BlastCP's own error_description, shown in the drawer
```

The answer back up the chain is a `WeftConnect` (`lib/blastcp-view.ts`): `connected` (with `email` and whether the
account was just `created`), `link`, `off`, `unavailable`, or `signed-out`. Everything but `connected` gets the drawer's
own wording from `weftConnectNote()`, so no server or BlastCP string reaches the user as-is.

- **Whose sign-in.** A sign-in you made with Connect in the browser (any `clientId` but `weft`) is never replaced by
  the timer; only the drawer's button (`force`) does. A sign-in made through Weft renews itself in its last week
  (`RENEW_MS`), so its expiry warning rarely shows, and its Reconnect goes through Weft, not the browser.
- **Disconnect means off.** The drawer's **Sign out** forgets the token *and* writes `{ off: true }` to
  `~/.weft/blastcp-auto.json`, so the timer doesn't connect it straight back. **Connect with Weft** clears the flag.
- **Nothing happens without a usable sign-in.** No Weft session answers `signed-out`; a Next server with no desktop app
  to hand the token to (`WEFT_SHELL_URL`) or a main from before this landed answers `unavailable`, and a locked Keychain
  is the Keychain's own error. A Weft connect needs the Keychain just as a browser one does.
- **In the drawer.** `components/BlastcpConnect.tsx` offers **Connect with Weft** (accent) beside **Another BlastCP
  account** (the browser sign-in), and the link-required line until a sign-in lands. Once connected, the drawer's
  **Reconnect** follows `viaWeft`, so a Weft-made sign-in renews through Weft rather than the browser, and the header's
  hover says so (`components/BlastcpDrawer.tsx`).
- **No takeover.** BlastCP never links a Weft identity to an existing BlastCP account by email alone; `link_required`
  sends you to a BlastCP page that needs that account's own session with the same email. Weft only opens a
  `link_url` on blastcp.com.
- **The tokens.** The Weft access token goes from the Next server to main over the token-guarded control server, the
  same path the account store already uses, and on to BlastCP; neither token reaches the board, a thread or a pane
  page. The route `POST /api/blastcp` answers only the outcome (`WeftConnect` in `lib/blastcp-view.ts`).
- BlastCP's side (the grant, `identity_links`, `/link/weft`) lives in the BlastCP repo,
  `docs/architecture/weft-token-exchange.md` there.

### What a Weft plan buys

Every Weft plan includes a BlastCP tier (`plan.blastcp`, a `BlastcpTier` in `lib/billing/plans.ts`): Free carries
`BLASTCP_FREE` (1 brand, 3 channels, 30 posts a month, $0.50 of generation credit once), and Pro and Team carry
`BLASTCP_CREATOR` (1 brand, every channel, unlimited posts, $3 a month of credit). weft.zip's pricing says so
([billing.md](billing.md#blastcp-usage), [marketing-site.md](marketing-site.md)). **Nothing enforces it yet**: the token
exchange above carries only the Weft JWT, so BlastCP knows who you are and not which plan you're on. BlastCP would read
the plan there and set its own `org_subscriptions` row; until then the drawer and the posting queue behave exactly as they
do for any BlastCP account.

## Reading

Every read is one JSON-RPC `tools/call` POST to `https://blastcp.com/api/mcp` with the bearer token: the same
tools a thread's BlastCP connector uses, so Weft needs nothing BlastCP doesn't already ship.

- `whoami`: who you're signed in as.
- `get_started`: the workspaces and their properties. BlastCP names properties **only** in this tool's text
  (`properties (pass one as property_slug): slug = Name, …`), so `parseWorkspaces()` reads them from it. If that
  wording changes, the picker comes up empty; a `list_properties` tool in BlastCP would make this solid.
- `list_posts { org_slug, property_slug, limit: 100 }`: the property's newest posts. `queueOf()` turns them into
  what goes out next (scheduled or publishing, soonest first), drafts, posts waiting on a human approval, failures,
  and the last one published.

## Making a property

The picker's last row, **+ New property**, opens a small form: a name (your search, else the folder's name in words,
`newPropertyName()`) and, when you're in more than one workspace, which one. **Create & link** calls BlastCP's
`create_property { org_slug, name }` (BlastCP derives the slug and seeds a starter voice and playbooks), then writes
the link from the slug it returns. A slug the workspace already has comes back as BlastCP's error and the form stays
open to rename. A window or main from before this landed asks for a restart (`createProperty()` in `lib/blastcp-view.ts`).

## Links

Which property a folder posts as lives in `~/.weft/blastcp-links.json` (`{ "<folder>": { org, property, name } }`),
not in the repo: it's your setting, and a teammate may post as someone else. Unlink only forgets the link; nothing
changes on BlastCP.

## Opening things

Post rows open the post's BlastCP page (`review_url`) in the browser pane; the property name opens its queue, and
the counts line opens its drafts. Your BlastCP session in the pane is separate from Weft's token.

## Safety

- The token never reaches the board, a thread, or a pane page: main seals it with safeStorage and makes every call.
- The IPC handlers answer the board window only (`isBoard(sender)`), like the vault and Vercel.

## Not built yet

- Drafting or scheduling a post from a card (a thread can already do that through the BlastCP MCP connector).
- A rail badge for posts waiting on you, which would need a poll while the drawer is shut.

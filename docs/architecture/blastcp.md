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
- Tokens last **30 days and can't be refreshed** (BlastCP only grants `authorization_code`). The drawer says
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

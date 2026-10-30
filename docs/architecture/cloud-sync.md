# Cloud sync

Status: usable, off by default, 2026-10-16. A card can be started from the web board (see Commands); the `cloud_commands` migration is applied. Settings → Sync turns a project on, and the web board at
`weft.zip/<workspace>/board` reads its cards back live. The migration is applied. Item bodies go up as plain JSON unless
sealing is on (mobile-security.md), so this isn't offered to anyone else until sealing is the default (see Gaps).

The goal: a card's thread reads the same on another device as on the Mac that runs it. `lib/cloud-sync-types.ts`
is the contract between the parts:

- `lib/cloud-sync.ts`: the outbox. A bus listener (no network, no awaits) turns `card`, `card_deleted` and `thread`
  events for opted-in folders into lines in `~/.weft/sync-outbox.jsonl` (`lib/cloud-outbox.ts`). A card change, a `user`
  item (a message you sent, from the Mac or the web) and a turn's `result` flush at once; a turn's other items arm a flush
  1 s out (`FLUSH_SOON_MS`) that later items don't push back, so a burst of tool calls is one request and the web reads a
  turn as it runs. A 10 s tick picks up whatever is left (entries from before a restart). A flush compacts the
  file, then uploads from the store's current state (not the event; the upload half is `lib/cloud-sync-upload.ts`):
  cards, deletes and truncates first, then thread items 100 to a request, each chunk dropped from the outbox by
  position as it lands, so an update that lands mid-upload stays queued and a backlog of tens of thousands makes
  progress instead of one giant request. Every row goes through `scrub()` first: Postgres refuses a NUL or a lone
  UTF-16 surrogate in text and jsonb ("unsupported Unicode escape sequence"), and a terminal's output has both;
  before the scrub one such item failed the whole batch on every retry and nothing uploaded. Cards, items and
  long tool outputs are also redacted on the way out (`lib/cloud-sync-redact.ts`, the share redactor; ids and paths
  kept), since every workspace member can read these rows. If the server still
  refuses a chunk with a data error (Postgres class 22), its rows go one at a time and the refused ones are skipped
  and named in `lastError` ("Skipped N items the server refused"); Supabase sits behind Cloudflare, whose WAF can answer a
  request with an HTML "Attention Required" page when a row's text looks like an attack (shell commands, SQL, `<script>`):
  that stalled the outbox from 2026-10-18 to 10-24. `lib/cloud-sync-send.ts` `upsert()` spots the page, re-sends the
  request with every string's non-alphanumerics written as `\uXXXX` (the same jsonb in Postgres, so readers change
  nothing), and a row still blocked is a `WafError`: skipped like a data error, named with its Ray ID, card and item;
  other HTML errors are named by their title, never dumped; a dropped connection or row-level security
  stays a backoff that keeps everything. A request holds one row per primary key (`lastPerKey`): Codex reuses tool ids like
  `item_1` from turn to turn, and Postgres refuses an upsert that names a row twice. Known gap: `cloud_tool_outputs` is keyed
  by (card, tool id), so two long outputs with one id still overwrite each other remotely; the later wins. Signed out or no workspace: entries wait. An
  error: backoff from 1 s doubling to 5 min, one warning per streak. Cards go to the user's personal workspace (the
  first org they own).
- `lib/blob-store.ts`: images, attachments and `~/.weft/show` pages referenced by an item are hashed (sha256),
  uploaded once to `weft-blobs/<org>/<sha>` and swapped for `blob:sha256:…` in the uploaded copy. Never anything
  outside home, in the vault, a token file or a `.env*`.
  That includes the page each `mcp__browser__open_url` call opened (its `summary` becomes `blob:sha256:<hex>#anchor`, the
  anchor kept verbatim) and a message's `page` with its anchor, so a card's pane history reads remotely (sharing.md). The path
  rules live in `lib/blob-paths.ts`.
- A Weft Worker uses this same store through a stand-in client and a narrower path rule (`lib/worker-blobs.ts`,
  [Pages from a worker](weft-worker.md#pages-from-a-worker)).
- `lib/blob-page-assets.ts`: an HTML page goes up with the local files it names, so its images load on weft.zip and the
  phone. `uploadPage` in the blob store finds each relative (or absolute, or `file://`) reference in `img`/`video`/`audio`/
  `source`/`track`/`script`/`embed` `src`, `poster`, `srcset`, icon links and CSS `url()` (in `<style>` and `style=""`),
  uploads each file as its own blob under the same `lib/blob-paths.ts` rules (never the vault, a token or a `.env*`; at most
  50 MB each), and writes its `blob:sha256:<hex>` ref (plus any `#fragment`) in its place. A local `<link rel=stylesheet>` is
  inlined as a `<style>` block with its own `url()`s read against the stylesheet's folder, since a stylesheet loaded from a
  signed URL couldn't have its refs signed. Only the uploaded copy changes, so the page blob's sha is of the rewritten
  bytes, not the file on disk. Web URLs, `data:`, missing files and `<a href>` links stay as written. Used for a message's
  `page`, an `open_url` call's page and the card row's `page` (`withUploadedPage`).
- `lib/blob-page-sign.ts`: the serving half. The web board's pane route (`app/api/web-board/[orgId]/page/[sha]`, as the
  visitor) and a share link's frame (`app/api/s/[id]/page/[sha]`, as the service client after the share check, via
  `serveBlobPage(…, { signAssets: true })`) swap each ref in an HTML page for a signed URL from `lib/blob-urls.ts`, R2 first,
  after redaction so a URL's token isn't masked. Signed URLs rather than a cookie route per asset: the page is sent with a CSP
  sandbox, so it runs in an opaque origin and its image requests carry no session cookie. A share signs whatever refs the
  owner's page names; those are blobs of the owner's own workspace, which the owner chose to share.
- `lib/cloud-sync-cards.ts`: builds the `cloud_cards` rows, uploading each card's pane capture (`thumb`, an
  `/api/attachments/…` file) as a blob and putting the ref in the uploaded copy only; the web board resolves it with
  the thread's refs (`lib/web-board-thumbs.ts`).
- `lib/thread-page.ts` + `app/api/cards/[id]/thread`: the reader side's shape, already used locally. `?before=&limit=`
  pages from the newest item back; a tool result over 2 KB (`TOOL_RESULT_INLINE_MAX`) is left out with
  `resultBytes`, and `/thread/tool/[toolId]` (or `cloud_tool_outputs` remotely) serves it when the row opens
  (`lib/use-tool-result.ts`). Tool output is ~70% of a thread's bytes.
- `lib/device-id.ts`: a random id for this Mac in `~/.weft/device-id`.
- Settings → Sync (`components/SyncSettings.tsx`, a page after Team in `lib/settings-nav.ts`): a status card ("Last sync 2m ago ·
  341 items uploaded · 0 waiting", "Sign in to Weft to sync", "Open the web board to claim your workspace", or the last error)
  with **Sync now**, then one switch per recent project, with a caution that thread text is uploaded unencrypted. It polls
  `/api/cloud-sync` every 5 s through `lib/use-cloud-sync.ts` (`GET` → `{ folders, status }`; `POST { folder, on }` switches a folder
  and, when on, `queueFolder()` queues its existing cards and items; `POST { sync: true }` flushes now). The status
  (`cloudSyncStatus()`, type in `lib/cloud-sync-view.ts`) is `waiting` (outbox lines), `lastSyncAt`, `uploaded` since start,
  `lastError`, `signedOut`, `noWorkspace`. Folders live in settings `syncFolders` (`setSyncFolder`).
- Across your Macs (`lib/cloud-sync-repos.ts`, `supabase/migrations/20261026145209_cloud_sync_repos.sql`): `syncFolders` holds
  local paths, which differ from Mac to Mac, so a second Mac used to start with every project off. The switch is also kept per
  GitHub repo in `cloud_sync_repos` (`owner_user`, `repo`, `enabled`; each user reads and writes only their own rows): the POST
  above records it (`rememberSyncRepo`, never holding up the answer), and every Mac publishes the repos it already syncs without
  overriding a switch made elsewhere (`ignoreDuplicates`), then turns sync on (and `queueFolder`s) for each recent project whose
  origin (`githubRepoOf` in `lib/repos.ts`) is an enabled repo: at start, every minute (`ADOPT_EVERY_MS`, which catches a fresh
  sign-in), and the moment a project lands on the board (`onProjectOpen("sync-repos")`, so a clone made on the new Mac syncs at
  once). It only turns sync on: a repo switched off elsewhere stays on where it already is. A folder with no GitHub origin stays per Mac.
- The avatar menu (`components/AccountSync.tsx`, lines from `lib/sync-menu.ts`): under your plan, one status line from the same
  `/api/cloud-sync` answer ("Synced 2m ago" + how many projects, "Syncing N items…", "Sync failed" + `lastError`, "Sync is off",
  "No workspace yet" with **Open the web board**), then **Resync now** (`POST { sync: true }`) and **Sync <project>** / **Don't sync
  <project>** (`POST { folder, on }`) for the board's work folder as its main checkout (`menuProject` in `lib/board-derive.ts`, never a
  scratch folder). These items keep the menu open, so the line shows the answer. `components/AccountButton.tsx` owns the hook, polling every
  30 s (`IDLE_POLL_MS`) for the avatar's dot (amber pulsing while `waiting`, red after an error, none otherwise) and every 5 s while the menu is open.
- The project's right-click menu (`lib/project-menu.ts`, run by `components/project-menu-handler.ts`): **Sync <project>** /
  **Don't Sync <project>** for that folder, with the project's own sync state on the same line as its sublabel — "Not Synced",
  "Synced 7m ago", "Syncing…", "Sync Failed", "Sign in to sync" (`projectSyncLine` in `lib/sync-menu.ts`). The board owns the
  hook (`components/Board.tsx`) and the menu reads it fresh when it opens (`readSync`, `read()` in the hook), so the line says how
  it stands now rather than when the board last looked; a failed read keeps the last known state and opens the menu anyway.
  **Sync** is greyed out when there's no account or no workspace yet, and a project that already syncs can still be turned off.
- The sync prompt (`components/SyncPromptDialog.tsx`, mounted beside the welcome in `components/HeaderBadges.tsx`; rules in
  `lib/sync-prompt.ts`, state in `lib/use-sync-prompt.ts`): "Turn on Project Sync for <project>?" for the project you're working on — the
  one the board is narrowed to, else the folder of the card that moved last, never the copilot, an archived card or a scratch folder
  (`lib/scratch.ts`). It waits for the welcome's answer and for one of that project's threads to reach Review or Done (so first launch asks
  after your first thread has shown what it does, not over it or over a question it asks), skips a project already in `syncFolders`, and asks at most once a launch (a module flag).
  **Sync** is the same `POST { folder, on: true }` as the Settings switch, then a toast; signed out it is Weft's one general sign-in ask, titled
  "Sign in to Weft?" with what an account adds (Project Sync, share links, leagues, the Puku trial) and **Sign in with GitHub**, then
  the sync ask once you're in; with no workspace **Open the web board**, and the window's focus reads the status again. **Don't show me again** sets
  `weft-sync-prompt-off` in localStorage; Settings → General → Reset tips (`resetOnboarding`) clears it.
- The web board (`app/[orgSlug]/board/page.tsx`, `components/web-board/*`, pure logic in `lib/web-board.ts`): behind the same
  `requireTeam` gate as Team and Billing, read as the visitor through their cookie session, so RLS decides what they see.
  It **is** the desktop board drawn read-only, not a lookalike: the cards are `components/CardView.tsx` with `readOnly` (no drag,
  stop, answer, resume, star or archive), the columns and their counts are `ColumnHeader` and `ColumnPlaceholder`, and what a
  column holds comes from the desktop's own `lib/board-view.ts` (`groupByColumn`, `summarizeProjects`, `SORTERS`), so a change
  to the board reaches both, and the columns themselves are the desktop's `BoardColumn` (drag handlers no-ops, Backlog's **Add a
  thread** opens New thread). The window around them is the desktop's too: `WorkspaceHeader` returns null on `/board`, and the
  desktop's own chrome takes its place — `components/BoardHeader.tsx` (`variant="web"`: the logo, "N running · M need you", New
  thread; the browser, terminal and Settings buttons are left out, since those live on the Mac), `components/BoardProjectBar.tsx`
  (`variant="web"`: the desktop's project chips, filter box and sort, with the Mac-only half of the project menu hidden), the
  desktop's `BoardColumns`, and the desktop's own rail buttons in `components/RailBoardButtons.tsx` (★ starred filter, 🏷 tags)
  inside the web's `WebRail` (★, then Board, Team, Billing). The `variant` seam is the whole trick: one implementation, with an
  explicit switch for what only the Mac can do. What stays the web's own: `WebAccountMenu` (workspaces, Team, Billing, Sign out),
  `WebLiveDot` (the header's `live` slot — the Realtime channel's state), the read-only tag list in the rail's 🏷 (the Mac owns the
  tag catalog), `WebShareBoard` and the web's dialogs. The board's ★ and 🏷 narrow it with the desktop's own
  `lib/rail-view.ts` (`RailFilter`, `filterCards`, `isFiltering`, `toggleTag`), the same shape the desktop's rail keeps.
  `.wz-desk` (`web-board.css`) gives the
  subtree the dark desktop tokens and the full window instead of the workspace shell's 252px sidebar column. The
  shell renders `<div class="wz-app wz-workspace">` — both classes on the *same* element — so the rule that widens
  the board must be a **compound** selector (`.wz-app.wz-workspace:has(.wz-desk)`); a descendant combinator
  (`.wz-app .wz-workspace`) asks for a `.wz-workspace` inside a `.wz-app` and never matches, which left the board in
  the shell's first column with the rest of the width empty. `components/web-board/web-board-layout.test.tsx` pins
  that shape. The server renders the
  workspace's non-deleted cards (the copilot is left out); `useWebBoard` subscribes to Realtime `postgres_changes` on
  `cloud_cards` and `cloud_thread_items` (filter `org_id=eq.<id>`) and moves, adds and removes cards in place, with a Live dot
  that goes grey when the channel drops. `?card=<id>` opens a card in `WebThreadPanel`, framed over the board like the desktop's open card
  (the desktop's `CardFrame` from `components/OpenCard.tsx`, `fixed inset-4`, a `role="dialog"` named after the card): the
  thread at 44% with the desktop ThreadPanel's header (CLI, folder, session, live, tags, stage and what's left) and, on the right,
  `WebPane`, the browser pane as of the thread's last `open_url` (`paneFor` from `lib/share-types.ts`): a synced page framed
  sandboxed from `app/api/web-board/[orgId]/page/[sha]` (the visitor's cookie client downloads it, so the bucket's member
  policy is the gate), a site framed with Open ↗, a localhost or file page as the card's last capture. The thread: `groupThread` and
  `ThreadEntries` from the desktop (oldest first, tool runs folded, `Markdown`), newest 50 first with "Load earlier messages",
  blob refs resolved to hour-long signed URLs from `weft-blobs` as items arrive (live ones too), and a tool output over 2 KB
  read from `cloud_tool_outputs` when its row opens, through `ToolResultSourceContext` in `lib/use-tool-result.ts` (the desktop
  fetches the same row from its own server). A signed blob link has no file extension, so `mediaKind` takes it for an image.
  The cards' own controls (drag, star, archive) are absent; the board's writes are **New thread**, and a reply, an answer or Stop in an open card (see Commands).

## The `variant` seam

The desktop's board components are drawn by both hosts. The switch is a `variant?: "desktop" | "web"` prop that
defaults to `"desktop"`, so the desktop's call sites don't change. It turns off only what genuinely needs the Mac:

- `components/BoardHeader.tsx` — `variant="web"` leaves out the browser pane button, the terminal drawer button and the
  local Settings button, and the share button becomes the host's own (`slots.share`). The desktop's live dot has no
  slot to fill, so `slots.live` is optional and the web's `WebLiveDot` fills it.
- `components/BoardProjectBar.tsx` → `components/ProjectBar.tsx` → `components/ProjectMenu.tsx` — `variant="web"` makes the
  project menu the picker alone: the Mac-only half (open folder, clone repo, new project, the project's changelog) is left
  out, since weft.zip can't reach the Mac's filesystem. The sort `<select>` also gets `colorScheme: "dark"`, so the browser's
  own dropdown isn't light-on-dark.
- `components/RailBoardButtons.tsx` — the rail's ★ and 🏷 buttons and the `useRailCardDrag` hook, shared by
  `components/LibraryRail.tsx` and the web's `components/web-board/WebRail.tsx`. Only the buttons are shared: the 🏷 drawer
  behind them is the host's (the desktop's `TagsDrawer`, the web's read-only list of the synced tags).
- `components/OpenCard.tsx`'s `CardFrame` — the framed window over the board. It is a `role="dialog"` with `aria-modal`,
  named by an optional `label` (the card's title on weft.zip; the desktop leaves it to the panel's own heading), and the
  backdrop carries `data-backdrop`.

Everything else — the header layout, the project chips, the filter box, the sort, the columns, the cards, the framed
open-card window, the reply box and its modes — is the desktop's code path on both hosts.

## Commands: starting a card and replying from the web

The web can't run a thread, so a card made there, or a reply typed there, is a request to a Mac. `public.cloud_commands`
(`supabase/migrations/20261016065614_card_commands.sql`, contract in `lib/cloud-commands.ts`) holds one row per request:
`kind` (`new_card` or `reply`, `supabase/migrations/20261018131849_reply_commands.sql`), `target_device` and `folder` (a `cloud_cards.owner_device`/`folder` pair of the author's own cards), a `payload`
(a new card's `prompt`, `backend`, `model`, `effort`, never the permission mode; a reply's `cardId` and `text`) and a `status` (`pending` → `claimed` → `done`, or `failed` with an
`error`, plus the `card_id` made).

- **Ownership.** A `BEFORE INSERT` trigger (`private.check_cloud_command_device`, `20261018130000_cloud_commands_device_ownership.sql`) refuses a row whose `device_id` isn't a device of the row's `account_id` in `public.devices`, so a signed-in user of one account can't insert a command aimed at someone else's Mac. The receiver's check on `lib/cloud-inbox.ts` also cross-checks the row's `account_id` against its own session, not just the `device_id`. `card_id` is set only by the receiver after `createCardFromBody` accepts the request; an insert that writes a non-null `card_id` is rewritten to `NULL` by a `BEFORE INSERT` step, so the client can't pre-claim a card.

- **Web** (`components/web-board/WebNewCardDialog.tsx`, `useWebBoard.startCard`, `lib/web-commands.ts`): the header's New thread offers
  `webTargets` (folders of cards whose `owner_user` is you), inserts the row as you, and `WebCommandStrip` follows it ("Waiting for your Mac",
  "Starting…", the failure, Cancel/Dismiss) over Realtime. When the command is done and the card's row has synced back, the board opens the card.
- **Mac** (`lib/cloud-inbox.ts`, started with the outbox from `cloud-sync-start.ts`): while you're signed in and a folder syncs it listens on
  `cloud_commands` filtered to this device, and checks every 30 s as well (a socket can drop while the Mac sleeps). A Realtime event is only a
  nudge: it reads this device's pending commands made by the signed-in account, claims each with an update that only matches `pending`
  (so one runs once), refuses it unless the folder is in `syncFolders` and `org_id` is the workspace this Mac syncs to, then
  `createCardFromBody` (shared with `POST /api/cards`, `lib/new-card.ts`) and `startCard` run it with the Mac's own default permission mode.
  It reports `done` + `card_id` or `failed` + a short reason; a claimed command is never retried, so a card can't be made twice.
  The same start also runs the timer that keeps shared mini apps' link previews current (`lib/app-preview-refresh.ts`;
  mini-apps.md).
- **Replies** (the desktop's `components/ReplyBox.tsx` over the cloud transport, `useWebBoard.sendReply`, `replyCommand`/`replyBody`): the open card's reply box
  shows only when `owner_user` is you (`canReply`), and sends a `reply` addressed to the card's `owner_device` and `folder`. The Mac
  runs the same checks as for a new card, then refuses a card that isn't on it or isn't in that folder (and the copilot), and calls
  `sendUserMessage`, the reply box's own path: now, or held as "after this turn" while one runs (the web shows `card.scheduled`'s
  `afterTurn` messages above the box). A reply shows above the box (`components/web-board/WebReplyStatus.tsx`, `cardReplies`, not in
  the strip: `boardCommands`) until it's done; then the web deletes its row, and the `user` item, flushed at once, is the message in the
  thread. While the card runs, the reply box holds what you write and sends it when the turn ends, as on the desktop; its **Send now**
  sends a `stop` first.
- **Answers and Stop** (`answer` / `stop`, `supabase/migrations/20261018132208_answer_stop_commands.sql`, `answerCommand`/`answerBody`,
  `stopCommand`/`stopBody`): the permission request or question a card waits on is answered from the web through the desktop's own
  `PermissionActions` and `QuestionForm`; the answer carries the request's `pendingId`, so the Mac's `answerPermission` refuses it once
  that request isn't waiting anymore. Stop (the reply box's ■) ends the running turn through `stop()`. Same checks as a reply.
- **Policies**: members read; a member inserts as themselves (only `org_id, kind, target_device, folder, payload` are grantable, so a client can't
  write its own status); only the author updates `status, card_id, error` or deletes (cancel before it runs, clear after).

## One thread view, two transports

The open card on weft.zip is the desktop's own `ThreadPanel` → `ThreadView` → `ReplyBox`, not a lookalike: what differs is where the
thread comes from and where its actions go, `lib/thread-transport.ts`'s `ThreadTransport`, read from `ThreadTransportContext`.

| | Desktop (`localTransport`, the default) | weft.zip (`components/web-board/useCloudTransport.ts`) |
|---|---|---|
| A page | `GET /api/cards/<id>/thread?before=&limit=` | `cloud_thread_items` by `seq`, through the visitor's session (`lib/cloud-thread-page.ts` `pageFromRows`) |
| Live | `/api/events` "thread" events (`applyThreadEvent`) | the board's one Realtime channel, handed on by `useWebBoard`'s item bus (`pageUpdateFor`; a DELETE cuts the window at its seq) |
| Drawing | items as they are | blob refs → signed URLs (`CloudBlobContext`, so a URL landing redraws without a new transport) |
| Stop | `POST /api/cards/<id>/stop` | a `stop` command |
| `!` shell, ↑ edit, folder grants, Wait, a subagent's Stop | the card routes | left out, so the views don't offer them |

`desktop: false` also makes `ThreadPanel` read-only in its header (the CLI as a badge, no mode picker, no rename, no card actions) and
drops the review panel and Send later; the web's `footer` (WebReplyStatus) stands in. Sending and answering stay the panel's `onSend` /
`onAnswer` props, as on the desktop board. A teammate's card opens `readOnly`: no reply box and no answers. The composer is the
desktop's too; a pasted image, dictation and the `/skill` typeahead call the local server's routes, which weft.zip refuses, so
there they fail (a paste shows the refusal) until the transport carries an upload.

## Ownership

The Mac running a card owns it: `owner_user` is the account that runs it and the only one that may write its rows,
`owner_device` is which of that account's Macs. Everyone else in the workspace can read. A deleted card keeps its row
with `deleted` set.

## Schema

Three tables, all keyed on `(org_id, card_id)` so a workspace's cards sit side by side and a single
policy covers them.

### `cloud_cards`

One row per synced card, upserted on every change. The jsonb body is the card's metadata
(`lib/types.ts`'s `Card`): column, title, tags, assignee, the latest cli/model, the unread count. Not
the thread — that's `cloud_thread_items`. `updated_at` is touched by `private.touch_updated_at`, the same
trigger the teams and profiles tables use, so Realtime subscribers know the card moved. Three columns
beside the jsonb name the card's current page, so a feed draws a card from this row alone; see
[The card's page](#the-cards-page).

### The card's page

`page`, `page_thumb` and `pages` (`supabase/migrations/20261029104011_cloud_cards_page.sql`) are for a reader that shows
each card as its pane, the way the phone app (`~/dev/weft-mobile`) does: one row, no thread items.

| Column | Type | What it holds |
|---|---|---|
| `page` | `text`, null when the pane has shown nothing | The page the card's pane shows now, in one of three forms (below). The same string is in `card.page`. |
| `page_thumb` | `text`, null | Only when `page` is a local page: the card's pane capture as a `blob:sha256:<hex>` ref, to draw instead. |
| `pages` | `integer`, default 0 | How many pages the pane has opened on this card (also `card.pages`). It counts up by one for every open, including the same file opened again. |

`page` is one of:

- **`blob:sha256:<hex>#anchor`**: a page Weft uploaded to `weft-blobs/<org>/<hex>` (a `~/.weft/show` page or any file under
  home). The `#anchor`, when there is one, is kept verbatim: scroll to it after loading the blob. The blob's bytes are the page
  as it was when the row was written; a later write to the same file is a new hex.
  An HTML page names its images, videos and fonts as `blob:sha256:<hex>` refs too (`lib/blob-page-assets.ts`). Before showing
  it, take `pageBlobRefs(html)`, POST them to `/api/web-board/<org>/blob-urls`, and `signPageRefs(html, urls)`
  (`lib/blob-page-sign.ts`); or load `/api/web-board/<org>/page/<hex>`, which has already done that.
- **an `https://` URL**: a public site. Load it directly; it may refuse to be framed.
- **any other URL** (`http://localhost:3000/…`, a dev server, a `file://` page that couldn't upload): only the owner's Mac
  reaches it. Show `page_thumb` (null if no capture has been taken yet) and the URL as a label.

`paneFromUrl` in `lib/share-types.ts` is the classifier (`blob` / `site` / `local`); a reader can port it as is.

Where it comes from: `lib/card-page.ts` `notePage()` sets `card.page` and bumps `card.pages` every time a card's pane opens
a page, both from the agent's `mcp__browser__open_url` and from Weft's own `openInPane()` (`lib/browser-tools.ts`). That
covers the pages `lib/show.ts` writes: the starter page a turn opens on a blank pane, and the update page Haiku writes after
a turn that showed nothing. Those two are not thread items, so before this column a phone saw a blank card for such a turn.
`withUploadedPage()` in `lib/cloud-sync-cards.ts` builds the columns at flush time, after the thumbnail upload, so `page_thumb`
is already a ref. A card change (and `notePage` is one) flushes at once.

The swipe-through history is still the thread: each `mcp__browser__open_url` item's `summary` (and a `user` item's `page`),
oldest to newest, as `paneFor` reads them. Weft's own starter and update pages aren't in it; when the row's `page` differs from
the newest item's page, put it last. A page the user navigated to by hand in the pane isn't recorded, and neither is a
link an agent clicked into; `page` is the last page the pane was *told* to open.

### `cloud_thread_items`

One row per thread item, paged newest first by the thread route. `item` is the `ThreadItem` jsonb with
two transformations already applied: a tool result longer than `TOOL_RESULT_INLINE_MAX` (2 KB) is
replaced with a `resultBytes` reference, and any local path (an attachment, an image, a `~/.weft/show`
page) is swapped for a `blob:sha256:…` ref that points at `weft-blobs`. The full tool result is in
`cloud_tool_outputs`; the blob itself is in the storage bucket. The index on `(org_id, card_id, seq
desc)` is the paging query, verbatim.

### `cloud_tool_outputs`

One row per cut tool result, keyed by the same `(org_id, card_id)` plus the tool id. The thread page
fetches this when it opens an item that names a cut tool — locally from
`/api/cards/[id]/thread/tool/[toolId]`, remotely from the cloud table. `bytes` is the result's length so
a reader can show "12 KB" without downloading.

### The `weft-blobs` storage bucket

A private bucket. Each object is a file at path `<org_id>/<sha256>`: the org prefix is the access
boundary, the sha256 is the file's identity (a 16 KB image uploaded from two Macs lands at the same key,
so the second upload is a no-op). Members of the org may read and insert; there are no update or delete
policies for clients. A blob is alive for as long as anything still references it — a `cloud_thread_items`
item, a pane image, a `~/.weft/show` page — and a sync sweep on the owner Mac prunes the unreferenced
ones.

Readers on weft.zip are served from a Cloudflare R2 copy of this bucket when the blob has been copied there (a row in
`blob_mirror`), and from here otherwise: docs/architecture/r2.md.

## Policies

Three rules, written in the migration's comments:

- **Members of the org may read all three tables and the bucket.** A card that was opened on one Mac is
  visible to the rest of the workspace; the `is_org_member(uuid)` helper from
  `20261013161111_teams_rls.sql` is the only check.
- **Only the owner may write a card's row.** `owner_user = auth.uid()` on `cloud_cards` directly, and on
  `cloud_thread_items` and `cloud_tool_outputs` through the new `private.is_card_owner(org, card)`
  helper, which reads `cloud_cards` as its owner (`security definer`) so an item's policy doesn't
  recurse into the items table's own policy or hit `cloud_cards`'s policy at row-read time.
- **No client updates or deletes to the bucket.** Blobs are content-addressed; there is nothing for a
  client to "edit".

`auth.uid()` is wrapped in `(select auth.uid())` everywhere a policy references it, the way the other
migrations do, so the result caches for the row.

## Realtime

`cloud_cards` and `cloud_thread_items` are in the `supabase_realtime` publication, the same way
`github_events`, `webhook_deliveries` and `vercel_events` are, so another device hears a new item the moment
the owner's outbox posts it. `cloud_tool_outputs` is left out: outputs are big and fetched only when a row is
opened.

## Gaps

- Item bodies go up as plain JSON unless Settings → Sync's **Seal synced threads** is on; then items, card text and long tool
  outputs are sealed with the workspace key (mobile-security.md). Page blobs aren't sealed yet, and old rows stay plain until they change.
- A question or permission a thread asks waits in Needs you; a reply from the web doesn't answer it (it queues for after the turn). The assistant's text doesn't stream to the web either: it arrives as a whole item when written (`delta` events stay on the Mac).
- A teammate's Mac never acts on your requests and yours never acts on theirs: the Mac only runs commands its own account made. Sending work to a teammate would need an explicit opt-in.
- Finished commands stay in `cloud_commands`; nothing prunes them yet. A command whose Mac crashed between claiming and reporting stays `claimed` until it's cancelled.
- The Mac must be on and running Weft for a command to run; the web says "Waiting for your Mac" until it is.
- Settings → Sync's "Open the web board" opens `weft.zip/team`, because the app doesn't know the workspace slug; the
  workspace header there has the Board link.
- Two Macs on one account can both write the same card: the policies check the account, not `owner_device`.
- Blobs are never pruned.
- `Board.tsx` still fetches a card's whole thread and hands it to ThreadView as a seed, so paging doesn't yet save the
  first load; ThreadView then opens its own event stream (`useBoardEvents`) to keep its window live.

# Slack

Status: built 2026-10-25. Commits, pushes, deploys and card status post to a channel; `/weft` and @Weft start
cards; @Weft in a card's thread messages that card. Every card message links to the card on weft.zip.

Slack's four-colour mark on the left rail (after GitHub's, in `components/LibraryRail.tsx`) opens a drawer that
connects one Slack workspace to the board.

## Why Socket Mode

Weft runs on localhost, which Slack can't reach. GitHub and Vercel webhooks go through a relay on the deployed
Weft (docs/architecture/github-issues.md, webhooks.md), but Slack has a better way for a desktop app: **Socket Mode**,
an outgoing WebSocket from the app to Slack that carries slash commands and events. No public URL, no relay row,
nothing on Supabase. It needs two tokens:

- the **bot token** (`xoxb-…`, OAuth & Permissions), for `chat.postMessage`, `conversations.list` and `auth.test`;
- an **app-level token** (`xapp-…`, Basic Information → App-Level Tokens, scope `connections:write`), for
  `apps.connections.open`, which hands back the socket's URL.

## The Slack app

`lib/slack-manifest.json` is the app: bot user "Weft", the `/weft` slash command, the `app_mention` bot event, Socket
Mode on, interactivity off, the bot scopes `chat:write`, `chat:write.public` (post to a public channel it isn't in),
`commands`, `app_mentions:read`, `channels:read` and `groups:read` (the channel picker), `channels:join`,
`channels:manage` (the picker's **+ New channel**), and `incoming-webhook`. It also turns **Incoming Webhooks** on for
the deployed Weft's feedback path (`settings.incoming_webhooks.incoming_webhooks_enabled` — under `settings`, not
`features`), which is a separate thing from the Slack rail: the rail's bot token stays on the Mac, while the feedback
webhook is a URL the server can hold (docs/architecture/feedback.md).

- **New app**: the drawer's **Create the Weft app** opens `api.slack.com/apps?new_app=1&manifest_json=…` in the pane
  (`manifestUrl()` in `lib/slack-view.ts`), then Install to Workspace.
- **Existing app**: `pnpm slack:manifest <app id>` (`scripts/slack-app-manifest.mjs`) validates and puts the manifest
  on it through `apps.manifest.update`, with an app configuration token. Run it through the vault so the token stays
  out of the transcript: `mcp__secrets__run("pnpm slack:manifest A0…", ["SLACK_CONFIG_ACCESS_TOKEN"])`. Configuration
  tokens last 12 hours; the script never rotates one, because the new pair would land nowhere. When the scopes
  change, Slack asks for a reinstall (OAuth & Permissions → Reinstall), which issues a new bot token.

**There is no Web API method for incoming webhooks** — no create, no list, no delete. Slack's own reference lists only
`apps.manifest.*` for them, so the feature is turned on either by the manifest (a configuration token) or by hand in
the developer console. The manifest's answer carries no URL either. Two routes reach the address: an **install**,
whose OAuth answer includes `incoming_webhook.url` (needs the app's Client ID and Secret, from the console), or the
console's own **Add New Webhook to Workspace**, which shows the `https://hooks.slack.com/services/…` URL once, by
hand. Either way the URL belongs in the 🔐 vault (`SLACK_FEEDBACK_WEBHOOK_URL`, production) and nowhere else — a URL
that reaches a chat reaches a transcript for good.

## Who holds what

```
Slack ⇄ Socket Mode ⇄ Electron main (electron/slack.cjs)  ── tokens sealed in ~/.weft/slack-token.json (Keychain)
                          │   ▲
     POST /api/slack/inbound   control route POST /slack/post, POST /slack/call
                          ▼   │
                    Next server (lib/slack*.ts)  ── ~/.weft/slack.json: settings + each card's Slack thread
```

- **Main** (`electron/slack.cjs`, `slack-api.cjs`, `slack-socket.cjs`) keeps both tokens, like Vercel's and
  Cloudflare's: verified (`auth.test`, `apps.connections.open`) before they're sealed with `safeStorage` in one record,
  0600, denied to threads by `lib/secret-guard-files.ts`. It runs the socket (acks every envelope first, reconnects
  with backoff up to a minute), turns `/weft` and `app_mention` envelopes into a `SlackInbound` and POSTs it to the
  server with the launch token. It posts what the server asks through the control route `POST /slack/post`, joining a
  public channel once on `not_in_channel` — and only when Slack says the channel is public (`is_private: false`), since a
  private channel can't be joined and a channel Slack wouldn't describe is not one to guess at. The board talks to it
  over `window.weft.slack` (status, setTokens, forgetToken, channels).
- **Any Slack method** is one control route: `POST /slack/call` (`{"method", "body"}`) makes the call with the bot
  token, so the rail can read as well as post (`conversations.history`, `auth.test`) without the token leaving main.
  The server reaches it through `POST /api/slack/call` (`app/api/slack/call/route.ts`), which is the same
  `shell("/slack/call")` hop the posting route uses.
- **The server** (`lib/slack.ts`, started from `prewarm()`) decides what to post. No token ever reaches it.

## Projects and channels

The drawer has a **default channel** and a **default project**, and under **Project channels** any number of projects
mapped to channels of their own (`settings.links` in `~/.weft/slack.json`, one channel per project and one project per
channel; a later row for either replaces the earlier). The map works both ways (`lib/slack-route.ts`):

- **Out**: a commit, push, deploy or card update goes to the channel of the closest mapped folder holding it
  (`channelFor`: the folder itself or a parent, never a look-alike sibling), else to the default channel.
- **In**: `/weft` or @Weft in a mapped channel starts the card in its project (`folderFor`), else in the default project.

**The channel picker** is the provider drawers' own search list (`components/DbSelect.tsx`) behind a button naming the
channel (`components/SlackChannelPicker.tsx`): it narrows as you type, and in a project's row the channels named like the
project come first as best fits (`channelScore` in `lib/slack-view.ts`), then the ones the bot is in. **+ New channel**
makes a public channel in Slack (`conversations.create` in `electron/slack-channels.cjs`, the name made Slack-safe,
the bot in it from the start), named after what you typed or the project, and picks it. Channels load once Slack is
connected; when Slack refuses the list, its reason shows under the picker with **Reload channels**.

A mapped project that doesn't sync to weft.zip gets its own **Turn on sync** (`synced` in `GET /api/slack`), since its
messages can't link to the card until it does.

## What gets posted

| Update | Source | Where |
| --- | --- | --- |
| Commits | each board repo's `.git/logs/HEAD`, lines `commit…` (`lib/slack-git.ts`) | the project's channel |
| Pushes | `.git/logs/refs/remotes/<remote>/<branch>`, lines `update by push`, counted with `git rev-list` | the project's channel |
| Deploys | the latest Vercel deployment per linked project, every minute (`lib/slack-deploys.ts`, control route `/vercel/status`) when it ends READY, ERROR or CANCELED | the project's channel |
| Card status | a card landing in Needs you, Review or Done (`lib/slack-cards.ts`, the bus's `card` events) | the card's Slack thread |

- **The reflog, not hooks.** A commit comes from a thread's commit.sh, the commit page's buttons, a worktree
  landing or your own terminal; every one appends to the reflog. The watcher stats each repo every 5 seconds and reads
  only the new bytes. Its first look records where each file ends, so nothing from before Weft started is posted, and
  it keeps looking while Slack is off so switching it on doesn't post a backlog. A remote ref file that appears later
  (a branch's first push) is read from the start.
- **Card status settles for 2 seconds** (`SETTLE_MS`), since a Commit click moves a card to Review and then Done.
  Running and Backlog aren't posted: every turn passes through Running. A card started from Slack always gets its
  updates; any other card gets a thread (a first message in the channel, then replies) only with **Card status** on.
- **The preview** is the card's latest assistant reply without its BOARD STATUS line or code blocks, cut near 900
  characters (`previewOf` in `lib/slack-messages.ts`), with the stage and what's left.

## The weft.zip link

Each card message links to `https://weft.zip/<workspace>/board?card=<id>` (`webCardUrl` in `lib/slack-link.ts`), where
you can read the whole thread, reply, review and move the card. The card has the same id there (cloud sync), and the
workspace's slug comes from `orgs` for the org cloud sync uploads to. Cards are on the web only when their folder
syncs, so without sync (or signed out) the message goes without a link and the drawer offers **Turn on sync** for the
project Slack cards start in. Replying on the web needs the Mac running Weft (docs/architecture/cloud-sync.md).

## Talking to Weft from Slack

- `/weft fix the login bug`: a card in the channel's mapped project (else the default project), tagged `slack`, started at once. A slash command leaves
  no message, so the card's first message is the root of its thread.
- `@Weft fix the login bug` in a channel: the same, threaded under your mention.
- `@Weft also add a test` in a card's thread: sent to that card as your next message (`lib/slack-inbound.ts`).
- No project picked, an empty command, or a card that's gone: a one-line answer in Slack saying what to do.

## Files

- `electron/slack.cjs` (`createSlack`, `registerSlack`, `slackRoutes`, `setupSlack`), `electron/slack-channels.cjs` (list and
  create), `electron/slack-api.cjs`,
  `electron/slack-socket.cjs`, `electron/slack-inbound.cjs`, `electron/slack-who.cjs` (the cached auth.test answer, and
  when a dead token throws it away); started by `electron/providers.cjs` (with BlastCP, Cloudflare
  and Goose, out of `main.cjs` for its size cap), wired in `electron/pane-routes.cjs` and `electron/preload.cjs`.
- `lib/slack-types.ts` (the shapes all three sides share), `lib/slack-store.ts`, `lib/slack-messages.ts`,
  `lib/slack-git.ts`, `lib/slack-deploys.ts`, `lib/slack-cards.ts`, `lib/slack-inbound.ts`, `lib/slack-link.ts`,
  `lib/slack-post.ts`, `lib/slack-route.ts`, `lib/slack.ts`.
- `app/api/slack` (GET/PUT settings), `app/api/slack/inbound` (from main), `app/api/slack/test` (the drawer's test post).
- `lib/slack-view.ts`, `lib/use-slack.ts`, `components/SlackDrawer.tsx` (connect), `components/SlackSettings.tsx`
  (connected: channel, events, project), `components/SlackLinks.tsx` (projects ⇄ channels),
  `components/SlackChannelPicker.tsx` (the channel button and its search list, + New channel), `components/SlackLogo.tsx`.
- `lib/slack-manifest.json`, `scripts/slack-app-manifest.mjs` (`pnpm slack:manifest`).

## Later

- Buttons on card messages (Commit, Move to Done) need interactivity, which Socket Mode also carries.
- A DM option for Needs you.
- The deploy watch asks Vercel once a minute; Vercel's `deployment.*` webhook events through the relay would make it instant.

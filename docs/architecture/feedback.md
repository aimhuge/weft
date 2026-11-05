# Feedback

The feedback path behind the board's (now removed) footer dot: Haiku interviews you about what's in your way, writes
a summary you check, and sends it to the Weft team's Slack.

**The dot is gone from the UI.** `components/FeedbackDot.tsx` and `components/FeedbackChat.tsx` were removed from the
board's footer (`components/BoardFooter.tsx`), along with the board-side hook `lib/use-feedback.ts`. The API path and
weft.zip's collector below are unchanged and still work, so a future surface (a menu item, a Settings row) can reuse
them as they are.

## Flow

1. **The dot** (removed). It used to sit at the right end of the board's footer; a click opened a popover
   (`components/FeedbackChat.tsx`) above the dot, where Escape, ✕ or a click outside closed it, and `useOverlay` hid
   the native browser pane so it wouldn't draw over the chat.
2. **The interview** (`lib/use-feedback.ts` → `POST /api/feedback`). The chat starts with a fixed opener
   (`FEEDBACK_OPENER`), so it never waits on Haiku to say hello. Each answer sends the whole transcript.
   `turnPrompt` asks Haiku for one follow-up at a time (two to four is usually enough). It answers as JSON:
   `{reply, summary: null}` while it's still asking, or `{reply, summary}` once it has enough. `parseTurn` treats
   text that isn't that JSON as a plain reply. One `complete()` (`lib/haiku.ts`) per turn takes about 8 to 15 s;
   the chat shows "Thinking…" meanwhile.
3. **"That's all: write the summary"** sends `wrap: true`. The route then uses `summaryPrompt`, which asks for the
   summary alone. Haiku ignored a "wrap up now" line inside the interview prompt and kept asking questions, so the
   button got a prompt of its own. `parseSummary` answers `WRAP_REPLY` with the summary, or `WRAP_FAILED`.
4. **The summary card.** A title and 3 to 6 bullets in the third person. **Send to the Weft team** sends it;
   **Add more** focuses the box, and a new answer clears the summary until Haiku writes it again.
5. **Send** (`POST /api/feedback/send`). Adds your Weft account's name and email when you're signed in, so the team
   can write back, plus the app version. Forwards it to weft.zip (`forwardFeedback`, `lib/feedback-send.ts`). Keeps a
   copy either way in `~/.weft/feedback/<iso>-<id>.json` (`lib/feedback-store.ts`), with `sent` set to whether
   weft.zip accepted it.
6. **The collector** (weft.zip `POST /api/feedback/collect`, `collectFeedback`). Public, like the telemetry
   collector, so it checks everything. A summary is required; the transcript (≤ 30 messages, ≤ 4000 chars each),
   sender and version are clipped. Each address can send 5 per 10 minutes (counted in each server instance's memory).
   It then:
   - inserts a row into `public.feedback` (service role; RLS on, no policies) when `SUPABASE_SECRET_KEY` is set
   - posts `slackText()` (Slack mrkdwn: escaped text, bullets as •, the sender as a mailto link) to the
     `SLACK_FEEDBACK_WEBHOOK_URL` incoming webhook

   It answers 204 when either step worked, 502 when both failed, 503 when neither is set up, 400 for a bad body
   and 429 past the limit.

## Slack

The team channel is reached through one Slack incoming webhook on the deployed Weft. That keeps it apart from the
Slack rail (docs/architecture/slack.md), which connects a user's own workspace through Electron main. Feedback
comes from every user's Mac, and most of them never connect the team's Slack.

To set it up: put the app's **Client ID** and **Client Secret** (Slack → your app → OAuth & Permissions → Basic
Information) in the 🔐 vault as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`, push them to Vercel, then open
`https://weft.zip/api/slack/oauth/install` and pick the channel. The install's answer lands the webhook's address
in `public.slack_webhooks`, and the collector posts there. The older route — copying the `https://hooks.slack.com/…`
address out of the console by hand into `SLACK_FEEDBACK_WEBHOOK_URL` — still works, but it puts a credential in a
transcript, so prefer the install.

**The rail and the webhook are two different things.** The rail (the bot token in the Mac's Keychain, Socket Mode
running) is what posts a board's commits and card updates; it works on its own. The webhook is a URL the *deployed*
Weft holds, because the Mac's token is sealed and can never leave it. A Mac with a healthy Slack rail can still have
feedback that never arrives, because the webhook is a separate secret on a separate machine.

### Nothing sends unless both halves are up

The collector stores the summary **and** posts it to Slack, and answers 204 when either worked. So a summary can
reach weft.zip and still never appear in the channel, and the sender sees "Sent to the Weft team" either way.

Two things have to be true for the Slack half, and both drifted once already:

- `public.feedback` has to exist. Its migration was written but never applied, so every insert failed and the
  collector answered 502 — with no error on the Mac, since the copy was still kept in `~/.weft/feedback`. It is
  applied now (`20261025181607_feedback.sql`).
- The webhook has to be where the deployed Weft can read it: a row in `public.slack_webhooks` (the install puts it
  there) or `SLACK_FEEDBACK_WEBHOOK_URL` on the deployment. A vault value that was never pushed to Vercel leaves
  the collector posting nothing. Check with `vercel env ls production`.

To prove both halves at once, POST a summary to `https://weft.zip/api/feedback/collect` and look for a row in
`public.feedback` **and** a message in the channel. The first without the second means the webhook is missing.

### Turning the feature on

Slack has no Web API method for incoming webhooks: no create, no list, no delete. Two different routes reach it,
and they answer different halves of the question.

**The manifest turns the feature on.** Incoming webhooks live under `settings` in the manifest, not `features`:
`settings.incoming_webhooks: { incoming_webhooks_enabled: true }` (`lib/slack-manifest.json`). There is no
`features.incoming_webhooks` subgroup, so a manifest that puts it there is silently ignored and the feature stays
off with nothing to say why. Applying the manifest needs an app configuration token (`xoxe-`, 12 hours) for
`apps.manifest.update`; `pnpm slack:manifest A0CBFBZMTV5` does it (docs/architecture/slack.md). The manifest's
answer is only `ok`, `app_id` and `permissions_updated`: no webhook, no URL.

**The OAuth answer carries the URL.** An install of the app returns `incoming_webhook.url` in its OAuth response,
and that URL is a real, listable webhook — not the once-only console one. The install needs the app to request the
`incoming-webhook` scope, which Slack supports as a **bot** scope only: put it in `oauth_config.scopes.bot`, never
under `scopes.user` (Slack rejects that with `illegal_user_scopes`). The scope's own reference says it "triggers a
user-facing channel picker in the OAuth 2.0 installation sequence" — the picker is what creates the webhook.

So the flow is three steps, and Weft runs all of them:

1. `GET /api/slack/oauth/install` (`app/api/slack/oauth/install/route.ts`) redirects to
   `https://slack.com/oauth/v2/authorize?client_id=…&scope=incoming-webhook&redirect_uri=…`. The user picks the
   channel. Nothing secret is in that URL — only the app's public client id.
2. Slack redirects to `GET /api/slack/oauth/callback` (`app/api/slack/oauth/callback/route.ts`) with a `code`.
3. The callback exchanges it with `oauth.v2.access` (`lib/slack-oauth.ts`) using the app's **Client ID and Client
   Secret** (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` — console only), and the answer's `incoming_webhook.url` goes
   straight into `public.slack_webhooks` (`lib/slack-webhook-store.ts`).

The URL lands in the database rather than a Vercel environment variable, because that is what keeps it out of a
deploy log, a transcript and a support screenshot. The collector reads it from there (`lib/feedback-send.ts`),
preferring `SLACK_FEEDBACK_WEBHOOK_URL` when both are set.

The Slack CLI's `apps.developerInstall` shortcut does *not* work for this: it skips the OAuth channel picker, so it
never creates a webhook and never yields a URL.

`oauth_config.redirect_urls` in the manifest must list the callback — without it Slack has nowhere to send the
code.

An incoming webhook is a channel-bound posting URL, not a way to reach any channel: the one Weft creates is bound to
the feedback channel, and `SLACK_FEEDBACK_WEBHOOK_URL` is that URL, not a channel id.

## Storage

- The Mac: `~/.weft/feedback/*.json`, one file per summary sent, with its transcript.
- weft.zip: the `public.feedback` table (`supabase/migrations/20261025181607_feedback.sql`). Read it in the
  Supabase dashboard.

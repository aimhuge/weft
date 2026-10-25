# Feedback dot

A small dot at the right end of the board's footer (the board's bottom-right corner). It opens a chat where Haiku
interviews you about what's in your way, writes a summary you check, and sends it to the Weft team's Slack.

## Flow

1. **The dot** (`components/FeedbackDot.tsx`, in `components/BoardFooter.tsx`). A click opens the popover
   (`components/FeedbackChat.tsx`), which opens above the dot. Escape, ✕ or a click outside closes it. While it's open,
   `useOverlay` hides the native browser pane, which would otherwise draw over it. The chat state lives in the dot,
   so closing and reopening keeps the conversation.
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

To set it up, create a Slack app at https://api.slack.com/apps, turn on Incoming Webhooks, and add one for the
feedback channel. Fill `SLACK_FEEDBACK_WEBHOOK_URL` (production) in the 🔐 vault, then push it to Vercel.

## Storage

- The Mac: `~/.weft/feedback/*.json`, one file per summary sent, with its transcript.
- weft.zip: the `public.feedback` table (`supabase/migrations/20261025033000_feedback.sql`). Read it in the
  Supabase dashboard.

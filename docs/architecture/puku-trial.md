# Puku trial

Status: built 2026-10-13; needs the two secrets on Vercel, the migration applied and a deploy before it works.

Weft ships puku-cli inside the app, so anyone can start a puku thread, including people who have never heard of
Puku. They shouldn't need a Puku account to try one, and Weft's own Puku key must never ship in the app (it would
come out of a DMG in a minute). So the key stays on the deployed Weft (Vercel), behind a proxy that only takes
short-lived trial tokens, which Weft hands to signed-in Weft accounts.

```
puku-cli (in Weft.app)                     weft-topaz.vercel.app                         api-cli.puku.sh
 apiKeyHelper: cat ~/.weft/puku-trial-token
 PUKU_AI_BASE_URL=…/api/puku  ──POST /v1/messages──▶ /api/puku/v1/[...path]
   x-api-key: wpt1.…                                   verify HMAC (no DB)
                                                       count request, check cap ──▶ puku_trial_usage (Supabase)
                                                       swap in PUKU_TRIAL_API_KEY ──────────▶ /v1/messages
                               ◀── SSE, untouched ──── read usage from the stream ◀──────────
                                                       add tokens ─────────────────▶ puku_trial_usage
```

## Who gets it

A puku thread uses the trial when puku-cli has no login of its own and you're signed in to your Weft account.
"A login of its own" (`hasOwnPukuLogin()` in `lib/puku-trial.ts`) is any of: puku-cli's session file
(`~/.config/pukucode/session.json` with an `accessToken`), `PUKU_AI_API_KEY` or `PUKU_CLI_OAUTH_TOKEN` in the env,
or an `apiKeyHelper` in `~/.puku-cli/settings.json`. People with their own Puku login keep using it; the trial
never overrides it.

**Offered before the first prompt.** The welcome's Get ready screen (`components/WelcomeIntro.tsx`) folds the trial into
puku-cli's row (`trialState()` in `lib/welcome-trial.ts`): with no agent logged in and you signed out of Weft, the row
says "try it free with your Weft account" with a **Try free** button that signs you in with GitHub; signed in, it reads
"Ready · free trial on your Weft account", counts as a ready agent, and the first thread runs on `puku` (`readyCli`).
So the login pop-up below is for later threads, not the first one.

## Flow

1. **A puku thread finds itself logged out.** The CLI fails with a not-logged-in error, and the runner's
   `needLogin` (`lib/runner.ts`) sees backend `puku` with no own login, so it calls `fetchTrialToken()` before
   opening Puku's login pop-up.
2. **Trial token.** `lib/puku-trial.ts` takes your Weft access token (`accountClient().auth.getSession()`) and
   POSTs it to `https://weft-topaz.vercel.app/api/puku/trial-token` (`WEFT_PUKU_TRIAL_URL` points elsewhere,
   without the `/trial-token`). The route (`app/api/puku/trial-token/route.ts` → `issueTrialToken` in
   `lib/puku-trial-token.ts`) asks Supabase Auth who the token belongs to (`GET /auth/v1/user`) and returns
   `{ token, expiresAt }`: `wpt1.<base64url {sub, exp}>.<base64url HMAC-SHA256>`, signed with
   `PUKU_TRIAL_SIGNING_SECRET`, good for 24 hours.
3. **On disk.** Weft writes the token to `~/.weft/puku-trial-token` (0600) and sets a timer to fetch a new one 2
   hours before it expires. `startPukuTrial()` (from `prewarm()` in `lib/copilot.ts`) picks the timer up again
   after a restart.
4. **Retry.** `retryAfterLogin("puku")` runs the thread again in a fresh CLI. `queryOptions()`
   (`lib/runner-session.ts`) asks `trialOptions()`, which, with no own login and a token good for another
   minute, adds `PUKU_AI_BASE_URL=…/api/puku` and `PUKU_CLI_API_KEY_HELPER_TTL_MS=300000` to the env, and
   `settings: { apiKeyHelper: "/bin/cat '<token file>'" }`, which the Agent SDK passes as `--settings`.
5. **Proxy.** puku-cli sends the helper's output as both `x-api-key` and `Authorization: Bearer` to
   `…/api/puku/v1/messages?beta=true`. `lib/puku-proxy.ts` checks the token, counts the request, swaps in
   `PUKU_TRIAL_API_KEY` (only `x-api-key`, Anthropic's header for `/v1/messages`) and forwards to
   `https://api-cli.puku.sh/v1/…`. The proxy used to forward both headers; `api-cli.puku.sh` answers
   `multiple_credentials` when it gets both, so `lib/puku-proxy.ts` now forwards just `x-api-key`.

Warm CLIs live for hours, so no token is baked into a CLI's env: puku-cli re-runs the helper every 5 minutes (and
after a 401), and the file always holds the current token.

### Verified against puku-cli 1.8.56 (outbound) and api-cli.puku.sh (inbound)

With `HOME` pointed at an empty folder (no Puku login), `PUKU_AI_BASE_URL` at a local mock gateway and
`--settings '{"apiKeyHelper":"cat <file>"}'`, every request arrived as `POST /v1/messages?beta=true` with
`x-api-key: <file contents>` and `Authorization: Bearer <file contents>`, `stream: true`, model `puku-ai-2.8`.
puku-cli reads `apiKeyHelper` from flag settings (`--settings`) as well as from its settings files.
`api-cli.puku.sh`'s `/v1/messages` rejects both headers together as `multiple_credentials`, so the proxy
forwards only `x-api-key` upstream.

## The proxy

`app/api/puku/v1/[...path]/route.ts`, on the Node runtime (`maxDuration = 300`, Vercel's default on every plan;
raise it on Pro for very long replies). Like the GitHub webhook relay (`app/api/github/webhook`), it has no
localhost guard (`lib/guard.ts` is for the desktop's own API): the signed token is the check. Without
`PUKU_TRIAL_API_KEY`, `PUKU_TRIAL_SIGNING_SECRET` or `SUPABASE_SECRET_KEY` it answers 503, so a local Weft serves
nothing.

- **Paths:** `messages`, `messages/count_tokens` and `models[/id]` only; anything else is a 404.
- **Auth:** an HMAC check, no database call. A bad or expired token gets a 401 in the Messages API's error shape
  (`authentication_error`), which puku-cli treats as logged out, so the desktop fetches a new token and retries.
- **Headers:** the hop's headers (`host`, `cookie`, `x-forwarded-*`, `x-vercel-*`, `accept-encoding`, the trial
  token) are dropped on the way in; `content-encoding`, `content-length` and `transfer-encoding` on the way out.
- **Streaming:** the reply body goes back through `metered()` (`lib/puku-proxy-usage.ts`), which passes every byte on
  unchanged and reads `usage` from the SSE `data:` lines (input and cache counts from `message_start`, output from the
  last `message_delta`) or from a JSON body. It reports **exactly once, however the reply ends**: read to the end, cancelled
  by the client, aborted with the request (`req.signal`) or broken upstream. The trial token works from any HTTP client, so
  before 2026-10-24 a script could read up to the last `message_delta`, hang up, and never be charged (the old
  `TransformStream` only recorded in `flush()`). A reply cut short is charged what it carried: `message_start`'s input (or
  the reservation's estimate when it never came), and as output the larger of the counted tokens and the streamed text
  (`delta.text`, `thinking`, `partial_json`) at four characters a token; a JSON reply cut short pays its full `max_tokens`.
  The route passes `after` as `background`, so the function stays alive to write the charge after a hang-up.
  A reply still open 15 s before the route's `maxDuration` (`deadlineMs`) is charged as cut short too: a client that
  reads the text and then sits on the socket would otherwise outlast the function and never let the reply end.

## Metering and the cap

`supabase/migrations/20261012230739_puku_trial_usage.sql`: `puku_trial_usage` (one row per Weft user per UTC day:
`requests`, `input_tokens` (including cache writes), `cache_read_tokens`, `output_tokens`), RLS on, users may read
their own row, nothing else is granted to clients. `puku_trial_add(...)` adds to the day's row and returns the totals
in one statement; execute is granted to `service_role` only. The proxy calls it through PostgREST with
`SUPABASE_SECRET_KEY` (`restUsageStore`), the same key the webhook relay uses.

**Reserve before spending.** `reserve(body)` estimates what a `messages` request could cost before it goes out: its input
from the text it carries (four characters a token; a base64 image or document is a flat 1,600) and its output at the
`max_tokens` it asks for (32,000 when it doesn't say). A request asking for more than `MAX_OUTPUT_TOKENS` (128,000) is a
**400**. On the Free path the request and that estimate go into the day's row in one `puku_trial_add`, so requests sent at
once can't each see the same room under the cap; when the reply ends, `settle` adds what was spent minus what was held
(a negative add, so per-day stats stay exact), and an upstream error gives the whole hold back, as does a refusal.
`count_tokens` holds nothing. A Pro workspace holds nothing in the day's row; it is refused when its allowance can't
cover the estimate.

Each messages request first adds 1 request (and its hold); if the totals are then over the cap, the proxy answers **429**
`rate_limit_error`: "You've used today's free Puku trial in Weft. Log in to Puku … to keep going, or try again
tomorrow." puku-cli shows it, and Weft's rate-limit handling (`lib/rate-limit.ts`) offers the switch to Claude.

| Cap | Default | Env override (Vercel) |
| --- | --- | --- |
| Requests per user per day | 150 | `PUKU_TRIAL_DAILY_REQUESTS` |
| Input + output tokens per user per day (cache reads don't count) | 1,000,000 | `PUKU_TRIAL_DAILY_TOKENS` |
| Requests per day, the whole trial (every account) | 15,000 | `PUKU_TRIAL_GLOBAL_DAILY_REQUESTS` |
| Input + output tokens per day, the whole trial | 100,000,000 | `PUKU_TRIAL_GLOBAL_DAILY_TOKENS` |

An agent turn makes a request per tool round, so 150 requests is roughly 5 to 15 real turns a day.

**The global cap.** Weft accounts are free, so one person can open many; the per-account cap alone has no ceiling.
`supabase/migrations/20261026164353_puku_trial_global_usage.sql` adds `puku_trial_global_usage` (one row per UTC day,
no client grants) and `puku_trial_global_add(...)`, the same atomic add-and-return as `puku_trial_add`. On the free
path `hold()` adds to the account's row and the global row at once (`Promise.all`, one round trip), and answers 429
when either is over: the account's own message first, else "Weft's free Puku trial is used up for today, across
everyone." A refusal gives the hold back to both rows, and `settle` trades hold for spend in both. Pro workspaces never
touch the global row. The defaults are about a hundred accounts at their full day (`GLOBAL_DAILY_*` in
`lib/puku-proxy.ts`). If the global row can't be reached (an outage, or a deploy before its migration), the request
goes on without the global cap and logs `Puku trial: global usage add failed`, like the plan meter's fallback.

## When the trial can't help

The runner opens Puku's own login pop-up and notes why (`noteTrial` in `lib/login.ts`, `LoginView.trial`), and
`components/LoginDialog.tsx` shows it above the login:

- **signed-out:** "Try Puku free: sign in to your Weft account …" with a **Sign in to Weft** button. When the
  sign-in lands, the `account` bus event reaches `startPukuTrial`, which calls `retryPukuWithTrial()`: it fetches a
  token, cancels the Puku login and runs the waiting threads again, and the pop-up closes.
- **unavailable:** the trial server said no (not set up, unreachable); its message, then "Log in to Puku below".
- **failed:** the thread failed again within 2 minutes of Weft getting a token (`trialJustFetched()`), so another
  token won't help (for example a stale puku session file that counts as an own login). This also stops a loop.

Signing out of Weft deletes the token file and its timer (`forgetTrialToken()`).

## Secrets

| Name | Where | What |
| --- | --- | --- |
| `PUKU_TRIAL_API_KEY` | 🔐 vault (production) → Vercel production | A Puku key made just for the trial; the proxy's upstream key |
| `PUKU_TRIAL_SIGNING_SECRET` | 🔐 vault (production) → Vercel production | Any long random string (`openssl rand -base64 32`) |
| `SUPABASE_SECRET_KEY` | already on Vercel (webhook relay) | Writes `puku_trial_usage` |

Push each with `mcp__secrets__push_to_vercel`; they take effect on the next deploy. Rotating the signing secret
ends every trial token at once; desktops fetch new ones on their next 401.

## Known gaps

- Weft accounts are free (magic link), so one person can open several for more trial, up to the global daily cap
  (above), which then stops the trial for everyone until the next UTC day. Puku's own limits on the trial key are the
  backstop behind it.
- Vercel limits request bodies to 4.5 MB, so a very long session with many images can outgrow the proxy.
- A Pro workspace's check isn't atomic: requests sent at once can each pass the allowance check and overdraw by what
  they spend together (billing.md's known gaps). The Free path's hold is atomic.
- The input estimate is text length, so a request heavy with PDFs (a flat 1,600 tokens each here) can be held for
  less than it costs; the real usage still settles it.
- A puku spare started before the token existed runs without the trial until its first failure retries it.

# Analytics

The deployed Weft at weft.zip sends analytics to two places: Google Analytics 4 and PostHog. A local Weft
(every Mac runs the same Next app on localhost, in `next dev`) never calls home, even with the PostHog keys
in its env: a builder's board, prompts and replies stay on their Mac.

## Consent

Nothing that sets an analytics cookie or records a session loads until the visitor says yes. `components/ConsentBanner.tsx`
(mounted by `app/layout.tsx` when `isDeployed()`, hidden on local hosts) asks once, in a small bar in the bottom-left
corner, and `lib/consent.ts` keeps the answer in `localStorage` (`weft-analytics-consent`: `granted` or `denied`) and
announces it with a `weft:consent` window event. One rule for every visitor, not an EU/UK geo check.

- **PostHog:** `startAnalytics()` calls `posthog.init` through `whenConsented()`: at once for a returning yes, else on the
  banner's event. A later no calls `opt_out_capturing()`.
- **GA4:** the server-rendered snippet sets up the `gtag` queue, and only appends gtag.js on a yes.
- **Changing your mind:** the privacy policy's Cookies section (`app/privacy/page.tsx#cookies`, `components/ConsentChoice.tsx`);
  yes → no reloads the page, since gtag.js can't be unloaded.
- `ThemeSync`'s identify runs on mount, so a visitor who accepts mid-visit is identified from their next page load.

Server-side events (`$ai_generation`, the onboarding stats' forwarder, OTLP logs) don't use browser cookies and aren't
behind the banner; the privacy policy covers them.

## The gate

- **Browser:** `lib/analytics-gate.ts` `isLocalHost()` refuses localhost, 127.0.0.1, ::1, `*.localhost` and
  file: pages (the browser pane's own). `instrumentation-client.ts` calls `startAnalytics()` (`lib/analytics.ts`),
  which starts nothing on those hosts.
- **Server:** `lib/analytics-server.ts` `serverPosthogConfig()` needs `isDeployed()` (`VERCEL` or `WEFT_HOME`,
  `lib/home.ts`) and both keys. `lib/ai-observability.ts` (Haiku and scout `$ai_generation` events) and
  `instrumentation.ts` (the OTLP log exporter `app/api/account` writes to) both go through it. It lives apart from
  `lib/analytics-gate.ts` so client code never reaches `lib/home.ts` and the home's `"use cache"` import
  (`lib/client-graph.test.ts` fails the build if it does).
- **GA:** `app/layout.tsx` renders `components/GoogleAnalytics.tsx` only when `isDeployed()`.

## Google Analytics 4

`components/GoogleAnalytics.tsx` is a server component that emits the gtag snippet for `G-L9YCWJ4LZ2` (gtag.js itself
after consent) on every weft.zip page (home, `/faq`, `/@user`, `/s/…`, `/a/…`, the web board). GA4's enhanced measurement sends `page_view` on load and
on client-side navigations. Named events come in through `window.gtag` from `track()`.

## PostHog

`posthog-js`, initialised by `startAnalytics()` with `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST`
(both public client values; production on Vercel from the 🔐 vault). Autocapture, pageviews, exceptions and session
replay follow the project's settings. It's the "Default Project" (56294) the other aimhuge sites share: filter on
`$host = weft.zip`.

`components/ThemeSync.tsx` identifies a signed-in weft.zip visitor by their Weft account id and resets on sign-out.
`app/global-error.tsx` sends the root error with `captureException`.

## Events

`track(event, props)` (`lib/analytics.ts`) sends one event to PostHog (if started) and GA (if gtag is on the page)
under the same name. On a local board both are absent and it does nothing.

| Event | Where | Props |
|---|---|---|
| `download_clicked` | home page download button | `version` (`github` before the first release), `href` |
| `download_redirected` | server side, `/download`, `/download/windows`, `/download/ios` (no consent needed) | `platform`, `arch`, `version`, `from`, `referrer_host`, `utm_source`/`utm_medium`/`utm_campaign`, `source: website` |
| `thread_started` | New thread (desktop and web board) | `backend`, `model`, `effort` |
| `thread_reply_sent` | reply box (desktop and web board) | `reply_type`: `message` or `continue` |
| `project_created` | New project form | none |
| `team_invite_sent` | board share panel, team invite form | `role` |

Server components can't take click handlers, so a link opts in with attributes:
`data-track="download_clicked" data-track-version="0.4.0"`. `startAnalytics()` adds one capturing click
listener (`trackClick`) that reads them, `data-track-*` becoming camelCased props, plus `href` on links.

## Downloads, cookie-free

`download_clicked` only reaches PostHog from visitors who said yes to cookies, so it undercounts. The real count is
`download_redirected`: every download link on weft.zip (`platformLinks` and `downloadLink` in `lib/home.ts`) points at
a redirect route, `/download` (the dmg), `/download/windows?arch=` (the exe) or `/download/ios` (TestFlight), with
`?from=` naming the button (`hero`, `closing`, `plans`, `signed-in`). The route redirects first, then `after()` from
`next/server` runs `captureDownload()` (`lib/download-track.ts`), so PostHog never slows the download. It captures
with posthog-node through `serverPosthogConfig()`: a random distinct id per download, `$process_person_profile: false`,
GeoIP off (the request comes from the server, so no visitor IP reaches PostHog), only the referrer's host, and short
lowercase labels for `from` and the utm tags (anything else is dropped). HEAD requests and bot user agents (crawlers,
link unfurlers, curl, empty UA) aren't counted. Bare `weft.zip/download` links in READMEs and posts are counted too,
with `from` null.

## Desktop onboarding stats

The one exception to "a local Weft never calls home": the welcome's steps, as anonymous events (`lib/telemetry.ts`).

- **What:** only the allow-listed events and props in `lib/telemetry-events.ts` (`onboarding_started`,
  `onboarding_tour_beat` (with `jumped` when the tour bar took you there), `onboarding_tour_nav` (the bar's Back, Next or a
  jump, with `from` and `to`), `onboarding_narration_muted`, `onboarding_signin_clicked`, `onboarding_cli_login`,
  `onboarding_step`, `onboarding_projects_answered`, `onboarding_first_thread`, `onboarding_skipped`). Plain values, strings
  cut to 40 characters; never a prompt, a project name, a path, an email or card content.
- **Who:** a 32-hex hash of the device ID (`anonymousId()`), so the stats can't be joined to the Mac's synced cards;
  PostHog gets `$process_person_profile: false` and `source: "desktop"`.
- **Consent:** on by default, with a switch in Settings → Security
  (`components/StatsSwitch.tsx`), kept in `~/.weft/telemetry.json`. The switch's PUT is `elevated()`, so only Weft's own
  window can flip it.
- **Path:** the board's `trackOnboarding()` (`lib/telemetry-client.ts`) → local `POST /api/telemetry` → the Mac forwards to
  `https://weft.zip/api/telemetry/collect` (`forwardOnboarding()`, dropped when off or offline, never queued) → the deployed
  Weft captures it with posthog-node (`captureOnboarding()`, `lib/telemetry-send.ts`). The Mac never holds a PostHog key.
- **Abuse cap:** the collector has no login, so `lib/telemetry-limit.ts` answers first: 60 posts a minute per address
  (hashed, in-process windows from `lib/fixed-window.ts`, 429 with `retry-after`), and 403 for a post with an `Origin`
  other than weft.zip's. The Mac posts from Node, which sends no `Origin`, so only a cross-site browser post carries one.
- **Where they fire:** `lib/use-onboarding-stats.ts` (started, steps), `lib/use-welcome-tour.ts` (beats, mute, the tour bar's moves),
  `components/WelcomeLoop.tsx` (sign-in), `components/WelcomeIntro.tsx` (CLI log in), `components/WelcomeDialog.tsx`
  (projects answered, first thread, skip).

## Desktop activation

The funnel past the welcome, over the same anonymous path and switch (`lib/activation.ts` `trackActivation()`, allow-listed
in `lib/telemetry-events.ts`):

- `activation_first_card` (`backend`): once per Mac, from `POST /api/cards`.
- `activation_first_done` (`minutes_since_first_card`, -1 when unknown): once per Mac, from a `PATCH /api/cards/[id]`
  that moves a card to Done.
- `desktop_active_day` (`has_done`): once per local day, from the board's `GET /api/cards`, so desktop retention shows
  for Macs that never make an account.

Weft asks you to sign in twice: the welcome's sign-in screen (`components/WelcomeAccount.tsx`) and "Sign in to Weft?"
after the first finished thread (`components/SyncPromptDialog.tsx`). `lib/use-signin-ask-stats.ts` measures both with
`where` = `welcome` or `first_thread`: `signin_ask_shown` once it opens signed out, `signin_ask_clicked` on the GitHub
button, `signin_ask_declined` (`never` when "Don't show me again" is ticked) on Not now, and `signin_ask_completed`
when the account turns up while it's open. The welcome's Not now stays `onboarding_account_deferred`. Read together,
these tell people who skip the account apart from installs that never open Weft.

A file in Weft's data folder (`ACTIVATION_FILE`) keeps what was sent, marked before the send so two quick calls can't
both send it. A new event name needs weft.zip redeployed before its collector takes it. Tests never send:
`test/activation-setup.ts` stubs the module for every file, and `lib/activation.test.ts` tests the real one through
`vi.importActual`.

## Key files

- `lib/analytics-gate.ts`: `posthogConfig()`, `isLocalHost()`.
- `lib/analytics-server.ts`: `serverPosthogConfig()`.
- `lib/download-track.ts`: `captureDownload()`, `isBotRequest()`, `downloadProps()`; `app/download/route.ts`, `app/download/windows/route.ts`, `app/download/ios/route.ts`.
- `lib/consent.ts`: `readConsent()`, `writeConsent()`, `whenConsented()`; `components/ConsentBanner.tsx`, `components/ConsentChoice.tsx`.
- `lib/analytics.ts`: `startAnalytics()`, `analyticsOn()`, `track()`, `trackClick()`.
- `lib/activation.ts`: `trackActivation()`, the desktop's first card, first Done and active days.
- `instrumentation-client.ts`, `instrumentation.ts`, `lib/ai-observability.ts`.
- `components/GoogleAnalytics.tsx`, `app/layout.tsx`, `components/home/Home.tsx` (the download button's `data-track`).

# Analytics

The deployed Weft at weft.zip sends analytics to two places: Google Analytics 4 and PostHog. A local Weft
(every Mac runs the same Next app on localhost, in `next dev`) never calls home, even with the PostHog keys
in its env: a builder's board, prompts and replies stay on their Mac.

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

`components/GoogleAnalytics.tsx` is a server component that emits gtag.js for `G-L9YCWJ4LZ2` on every weft.zip
page (home, `/faq`, `/@user`, `/s/…`, `/a/…`, the web board). GA4's enhanced measurement sends `page_view` on load and
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
| `thread_started` | New thread (desktop and web board) | `backend`, `model`, `effort` |
| `thread_reply_sent` | reply box (desktop and web board) | `reply_type`: `message` or `continue` |
| `project_created` | New project form | none |
| `team_invite_sent` | board share panel, team invite form | `role` |

Server components can't take click handlers, so a link opts in with attributes:
`data-track="download_clicked" data-track-version="0.4.0"`. `startAnalytics()` adds one capturing click
listener (`trackClick`) that reads them, `data-track-*` becoming camelCased props, plus `href` on links.

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

The rest of the desktop funnel (first card, first Done) still isn't tracked.

## Key files

- `lib/analytics-gate.ts`: `posthogConfig()`, `isLocalHost()`.
- `lib/analytics-server.ts`: `serverPosthogConfig()`.
- `lib/analytics.ts`: `startAnalytics()`, `analyticsOn()`, `track()`, `trackClick()`.
- `instrumentation-client.ts`, `instrumentation.ts`, `lib/ai-observability.ts`.
- `components/GoogleAnalytics.tsx`, `app/layout.tsx`, `components/home/Home.tsx` (the download button's `data-track`).

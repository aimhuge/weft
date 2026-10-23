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

The desktop app's own funnel (first launch, first card, first Done) isn't tracked: that needs opt-in telemetry with a
first-launch notice (docs/ROADMAP.md, Settings and onboarding).

## Key files

- `lib/analytics-gate.ts`: `posthogConfig()`, `isLocalHost()`.
- `lib/analytics-server.ts`: `serverPosthogConfig()`.
- `lib/analytics.ts`: `startAnalytics()`, `analyticsOn()`, `track()`, `trackClick()`.
- `instrumentation-client.ts`, `instrumentation.ts`, `lib/ai-observability.ts`.
- `components/GoogleAnalytics.tsx`, `app/layout.tsx`, `components/home/Home.tsx` (the download button's `data-track`).

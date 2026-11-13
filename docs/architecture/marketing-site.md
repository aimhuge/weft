# The marketing site

Status: built 2026-10-13, rebuilt 2026-11-12 around the open card (below).

weft.zip is the same Next app as the board, rendering a landing page instead of it: `app/page.tsx` renders the home
when `isDeployed()` (`VERCEL` or `WEFT_HOME`), and `app/home/page.tsx` always does, so it can be seen on
localhost. The board itself is untouched on a local run.

The home's content is split four ways, and the split is the rule worth keeping:

- **`lib/home.ts`** holds the links and metadata — `TAGLINE`, `DESCRIPTION`, `REPO`, `homeMetadata`,
  `downloadLink`, `platformLinks`, `isDeployed`, `parseFeed` — so `lib/home.test.ts` can read them without rendering.
- **`lib/home-story.ts`** holds what the story sections say — `HERO`, `DEMO`, `WHY`, `BOARD`, `LEVELS`, `xpRules()`,
  `GAME`, `OPEN` — read by `lib/home-story.test.ts`, which also refuses the word "loom" in page copy.
- **`lib/home-release.ts`** reads the latest release's `update.json` for the download button, falling back to GitHub's releases API when that download path is down.
- **`components/home/*`** draws it, as server components with no client JS.

```
lib/home-story.ts ─▶ hero + CardDemo / Why / MiniBoard / Game / OpenSource      (demo.css, story.css)
lib/home.ts ───────▶ HomeNav / Downloads / Tour / Plans + CloudWorkers / FaqTeaser / closing Downloads / HomeFooter
home-release.ts ───▶ the release the download buttons name                         (home.css)
```

## Why it is shaped this way

The first page led with a photo, a tagline and a real screenshot of a year-old board. What came back from visitors:
"what's a loom", the board looks busy and doesn't move, I can't see inside a card, and a lot of people are making
kanban boards for agents, so why this one. The game, the `@github` profiles and the public source didn't come through
either. So the page now answers those in order, and every picture on it is drawn in CSS from copy in
`lib/home-story.ts`, so nothing goes stale when the board changes.

- **`CardDemo.tsx`** (the hero): one open card. The thread takes a prompt and answers in three turns; the pane beside
  it shows what each turn made: a plan page, the running app, the review tour. One 18 s loop: each scene, reply and tab
  carries a `wz-cd-plan|app|review` class and the keyframes `wz-cdA/B/C` light them in thirds. The plan's steps carry an
  inline `animation-delay`, which on a looping animation is a phase shift, so one keyframe serves all three.
- **`Why.tsx`**: four cards, each striking what other boards leave you with over Weft's answer (a pane per card, the
  review tour, warm threads on one tree, the Touch ID vault).
- **`MiniBoard.tsx`**: four columns, six still cards and one traveler. The traveler is absolutely placed over the first
  slot and moved by whole columns (`wz-mbTravel`); the column it sits in steps its own cards down a slot. Both that and
  the traveler's state label read one registered custom property, `--wz-on`, which four phase keyframes (`wz-mbP1..4`)
  flip between 0 and 1. Everything is in `em` off a font-size that follows the viewport, so it is a whole board on a phone.
- **`Game.tsx`**: the XP rules through `xpRules()` (read from `XP`, `QUALITY_BAR` and `QUALITY_BONUS` in `lib/game.ts`),
  the six level pictures from `public/brand/levels`, and a sample builder card that links a real profile (`GAME.example`).
- **`OpenSource.tsx`**: the repo, the changelog and the license by its real name. Weft's source is public under FSL,
  which is not an OSI license, so the section is "Built in the open" and never says "open source".

Both demos rest on a still frame and add motion only inside `prefers-reduced-motion: no-preference`.

A stylesheet a component imports must exist before the import is written: on 2026-11-12 `Home.tsx` imported a
`story.css` that hadn't been written yet, and because `lib/home.ts` then reached `components/home`, every route that
imported it failed to build and Weft would not start. `loadHome()` moved to `lib/home-loader.ts` so only the two page
routes can reach the home page (docs/bug-fixes/051).

## Key files

- `components/home/Home.tsx`: the page, in order — nav, the hero (`HERO`, `<Downloads />`, `<CardDemo />`), `<Why />`,
  `<MiniBoard />`, `<Game />`, `<OpenSource />`, `<Tour />` (the narrated welcome tour), **`<Plans />`**, `<FaqTeaser />`,
  the downloads once more, footer.
- `components/home/Plans.tsx` + `components/home/Plans.test.tsx`: the pricing section (below).
- `components/home/Tour.tsx`: `public/brand/weft-tour.mp4` (the welcome tour, ending on Download for Mac instead of the shortcuts: docs/architecture/welcome-tour.md#rendering-scriptsrender-welcome-loopmjs) with `preload="none"` and its 3 s title card as the poster
  (`public/brand/weft-tour-poster.webp`); retake the poster when `pnpm welcome:render` changes the opening.
- `components/home/FaqTeaser.tsx`, `HomeChrome.tsx` (nav and footer), `faq.css`.
- `components/home/demo.css` (the two drawn demos and their keyframes) and `story.css` (the hero and the story sections).
- `components/home/home.css`: the shared type, nav, downloads, tour, plans and footer. Plain `wz-*` classes, not CSS modules, because
  `next.config.ts` sends every `.css` through Tailwind, which drops module exports.
- `app/opengraph-image.tsx`: the shared-link card for every weft.zip page (home, profiles, FAQ, shares), drawn by Satori
  with `public/fonts/fraunces-500.ttf`, a static cut of the variable Fraunces (opsz 144, wght 500, `fonttools varLib.instancer`):
  Satori throws on the variable font's axis names, which made the route 500 from 2026-10-16 to 10-23. Its three files are listed
  for tracing in `next.config.ts`, and `app/opengraph-image.test.ts` draws it. `public/brand/board.png` was the hero's screenshot until the rebuild; the page no longer uses it.
- `components/HomeErrorFallback.tsx`: the dark plain page both routes render when `loadHome()` fails.
- `docs/FAQ.md` and the `/faq` route are [faq-site.md](faq-site.md).

## The pricing section

`components/home/Plans.tsx` renders Free, Pro and Team as three `.wz-plan` cards, with Pro carrying
`wz-planFeatured`. It is a server component like the rest of the page, and **its prices are read out of the billing
catalog**, not typed:

- `priceFor(id)` calls `catalog.priceCents(id, "monthly")` and formats cents as dollars. Free renders as the word
  **"Free"**, not `$0`. The cadence follows `plan.perSeat`: `"/month"` for Pro, `"per seat / month"` for Team.
- `cardFor(id, features, featured)` reads the name and blurb from `catalog.get(id)`.
- `pukuAllowanceLabel()` renders `PRO_PUKU_TOKENS` in millions ("300M Puku tokens a month"), because
  "300,000,000" is not a number anyone reads.
- Free's Puku bullet quotes the free tier cap through `freeTierCapLabel()` ("1M tokens a day", `FREE_TIER`).
- The four coming-soon plans (Startups, Open source, Education, Regional pricing) were a dashed row under the cards
  (`AccessPlans.tsx`) until 2026-11-12. They came off the page because none can be bought yet; their numbers are still in
  the catalog ([billing.md](billing.md#startups-open-source-education-and-regional-pricing)).
- Under the three cards, `components/home/CloudWorkers.tsx` (`#wz-cloud`, `.wz-cloud*` in `components/home/cloud.css`)
  asks for **Weft Cloud Workers**: a Weft Worker we host ([weft-worker.md](weft-worker.md)), so cards run with the laptop
  shut and no server of your own. It isn't built or priced yet, so the card has no price: a plain form asks *what would
  you use a cloud worker for?* and an email, and posts to `/api/cloud-workers/request`. `lib/cloud-worker-request.ts`
  checks it and sends it the feedback dot's way (`collectFeedback` in `lib/feedback-send.ts`: the `feedback` table and
  the team's Slack, titled "☁️ Cloud worker request", rate-limited per address), then 303s back to the same-origin page
  at `#wz-cloudSent` or `#wz-cloudFailed`, where CSS `:target` shows the matching line. No client JS.
- Each card ends in its way in (`.wz-planCta`, clay on the featured card, `data-track="plan_clicked"`): Free's is the
  hero's download link, which `Home.tsx` passes in as `download`; Pro and Team link to `/billing?plan=pro|team`
  (`lib/billing/plan-link.ts`), which signs the visitor in, lands on `/<slug>/billing` and opens the upgrade dialog, whose
  button starts Stripe Checkout ([billing.md](billing.md#the-pieces)).
- `blastcpLines(id, plan.blastcp)` turns each plan's BlastCP tier into two bullets, naming who gets it as BlastCP
  applies it ("BlastCP Creator for the owner: 1 brand, every channel, unlimited posts" on Pro, "… for every seat" on
  Team, "$3 a month of BlastCP AI generation"), placed before the closing "Everything in …"
  ([billing.md](billing.md#blastcp-usage)). The access row names Creator for Open Source and Education too.

So a price change in `lib/billing/plans.ts` moves the marketing page with it, and the page cannot drift from what
the app actually charges. `Plans.test.tsx` (jsdom) asserts exactly that: the card names equal `catalog.order`'s
names, the amounts equal `catalog.priceCents("pro", "monthly") / 100` and `TEAM_SEAT_CENTS / 100`, and the cadences
are `/month` and `per seat / month`. Anything else the section says — feature bullets, the "cancel any time" note —
is copy in `CARDS`, and is free to change.

The section makes one promise that is real: Pro's feature list says "Invite your team into the workspace", and
`lib/billing/plan-gate.ts` enforces it ([billing.md](billing.md), [teams.md](teams.md)). A test asserts the copy and
the gate's rule line up, so the page can't quietly start selling teams that the code won't give.

The classes live under a `─── Plans ───` banner in `home.css`: `.wz-plans`, `.wz-planGrid`, `.wz-plan`,
`.wz-planFeatured`, `.wz-planName`, `.wz-planPrice`, `.wz-planAmount`, `.wz-planCadence`, `.wz-planBlurb`,
`.wz-planFeatures`, `.wz-planCta`, `.wz-planCtaFeatured`, `.wz-planNote`. The grid is three across, and drops to one column under the breakpoints.

## Patterns

- **The home can't take the board down.** `lib/home.ts` `loadHome()` dynamic-imports `components/home/Home` inside
  a try/catch and returns `{ error }` instead of throwing; `app/page.tsx` and `app/home/page.tsx` render
  `HomeErrorFallback` on it. This is the parse-error companion to `lib/route-import-guard.ts`; see
  `docs/bug-fixes/011-home-parse-error-took-board-down.md`.
- **Analytics only where analytics belong**: `data-track="download_clicked"` on the download button feeds
  `lib/analytics.ts` `track()` (GA4 + PostHog). See [analytics.md](analytics.md).
- **Copies live in `lib/home.ts`, not in JSX**, so a test can read them and the copy isn't buried in layout.

## Known gaps

- The title tag and the shared-link card still say "Engineering the future" (`TAGLINE`, drawn at 104px in
  `app/opengraph-image.tsx`); they should follow the new headline.
- The builder card in the game section is a sample; real public cards and a live GitHub star count would be proof.
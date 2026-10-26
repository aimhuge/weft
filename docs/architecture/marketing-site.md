# The marketing site

Status: home page, download button, pillars, pricing and the FAQ teaser built 2026-10-13; the weft.zip domain and
a deploy are still open.

weft.zip is the same Next app as the board, rendering a landing page instead of it: `app/page.tsx` renders the home
when `isDeployed()` (`VERCEL` or `WEFT_HOME`), and `app/home/page.tsx` always does, so it can be seen on
localhost. The board itself is untouched on a local run.

The home's content is split three ways, and the split is the rule worth keeping:

- **`lib/home.ts`** holds the words and links — `TAGLINE`, `DESCRIPTION`, `REPO`, `PILLARS`, `homeMetadata`,
  `downloadLink`, `isDeployed`, `parseFeed` — so `lib/home.test.ts` can read them without rendering.
- **`lib/home-release.ts`** reads the latest release's `update.json` for the download button.
- **`components/home/*`** draws it, as server components with no client JS.

```
lib/home.ts ──▶ Home.tsx ── HomeNav / hero + board shot / Tour / Pillars / Plans / FaqTeaser / HomeFooter
                     │            │                    │        │            │
home-release.ts ─────┘         home.css (prefixed CSS)  PILLARS  catalog     FAQ_HIGHLIGHTS
```

## Key files

- `components/home/Home.tsx`: the page, in order — nav, hero over the twin suns, the board screenshot, `<Tour />` (the narrated welcome tour), `<Pillars />`,
  **`<Plans />`**, `<FaqTeaser />`, footer.
- `components/home/Plans.tsx` + `components/home/Plans.test.tsx`: the pricing section (below).
- `components/home/Tour.tsx`: `public/brand/weft-tour.mp4` (the welcome tour, ending on Download for Mac instead of the shortcuts: docs/architecture/welcome-tour.md#rendering-scriptsrender-welcome-loopmjs) with `preload="none"` and its 3 s title card as the poster
  (`public/brand/weft-tour-poster.webp`); retake the poster when `pnpm welcome:render` changes the opening.
- `components/home/Pillars.tsx`, `FaqTeaser.tsx`, `HomeChrome.tsx` (nav and footer), `faq.css`.
- `components/home/home.css`: the page's whole look. Plain `wz-*` classes, not CSS modules, because
  `next.config.ts` sends every `.css` through Tailwind, which drops module exports.
- `app/opengraph-image.tsx`: the shared-link card for every weft.zip page (home, profiles, FAQ, shares), drawn by Satori
  with `public/fonts/fraunces-500.ttf`, a static cut of the variable Fraunces (opsz 144, wght 500, `fonttools varLib.instancer`):
  Satori throws on the variable font's axis names, which made the route 500 from 2026-10-16 to 10-23. Its three files are listed
  for tracing in `next.config.ts`, and `app/opengraph-image.test.ts` draws it. `public/brand/board.png`: the screenshot in the hero.
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
- Under the three cards, `components/home/AccessPlans.tsx` (`#wz-access`, `.wz-access*`) draws a quieter dashed row:
  Startups, Open source, Education and Regional pricing, two by two, each marked **Coming soon** until weft.zip can
  grant or sell it. Its numbers come from the catalog too (`STARTUP_TEAM`, `freeTierCapLabel()`, `REGIONAL_PRO_CENTS`); drop the Coming soon chip per card as each plan lands
  ([billing.md](billing.md#startups-open-source-education-and-regional-pricing)).
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

- weft.zip isn't on the domain in Vercel yet, so the canonical URL, the OG image and the Stripe return URLs all
  still point somewhere else.
- The board screenshot is a point-in-time capture; refresh `public/brand/board.png` after big board changes.
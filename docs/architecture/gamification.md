# Progress: streaks, XP, badges and the builder card

The header's 🔥 chip and its "Wefter Profile" dialog turn your work in Weft into a streak, a level, badges,
a builder card and each project's production-ready tree, and, when you're signed in to Weft, a weekly league.

## Data flow

```
board card events (lib/bus.ts)
  └─ lib/activity.ts trackActivity()  ── appends ──>  ~/.weft/activity.jsonl
                                                         │
GET /api/game?cwd=&full=1 ── lib/game-server.ts gameState()
                                ├─ lib/game.ts            XP, levels, days, streak, cloth, records (pure)
                                ├─ lib/game-attributes.ts attributes, class, stack skills (pure)
                                ├─ lib/game-badges.ts     badges, fixes, toasts (pure)
                                └─ lib/project-checks.ts  measures repos → lib/project-badges.ts tree (pure)
components/HeaderBadges.tsx → GameBadge.tsx (chip, AchievementPopup) → LoomDialog.tsx (+ LoomBadges, LoomCharts)
```

## The activity log

`~/.weft/activity.jsonl` holds one JSON event per line: `created`, `start` (with how many cards run at once),
`turn` (with how many turns), `done` (with the card's cost and title), `quality` (a project's daily
checklist score and coverage), `limit` (a plan window a Weft thread ran out of, below) and `explore` (the first use of a Weft feature, below). Every event has a stable id, so a sync can tell what it already sent.

- **Backfill.** The first read writes events for every card on the board (`backfillEvents`): created at
  `createdAt`, its turns at its last activity, Done at `updatedAt`. Imported Claude Code sessions count.
  Backfilled ids are `created:<card>`, `turns:<card>`, `done:<card>`, so re-running is a no-op; on each
  server start, cards the log has never seen (no `created:<card>`) are backfilled the same way.
- **History opt-out.** The first-launch welcome (`lib/welcome.ts`) asks whether your Claude Code history
  counts. The log keeps every event either way; with `countHistory` off, `gameState` drops events and cards
  from before the welcome's `at` (`countsAt`), so turning it back on in Settings → General restores them.
  A board adopted from before the welcome takes `at` from its first card made in Weft itself.
- **Live.** `trackActivity()` subscribes to the bus once per server process. `/api/events` (which the board
  opens first) and `/api/game` both call it. It remembers each card's column and turn count and logs what
  changed (`changeEvents`). The copilot is left out.
- Backfilled Done times are approximate (a card's last change), so "fastest ship" only times live Done events.

## Rules

- **XP**: created 2, turn 1, Done 10, or 15 when the project's latest quality snapshot before it scored 80+.
- **Levels**: level n starts at 40·(n−1)² XP. Titles at 1, 5, 10, 15, 20, 30: Thread, Strand, Yarn, Bolt, Loom, Tapestry.
- **Streak**: a day counts with any created, turn or Done event (local time). Each 7th day in a row earns a
  freeze (max 2); a missed day spends one. An empty today doesn't break it, it marks it at risk.
- **Attributes** (0–100): follow-through = Done ÷ started; velocity = 10 × shipped per active day (30 days);
  range = 6 per project with 3+ cards + 3 per technology; rigor = testing checks passed; guard = security and
  observability checks passed; craft = the craft habits shipped cards showed (below); stamina = active days of
  30 × 80 + best streak (max 20).
- **Craft habits** (`lib/craft.ts`): the skills each Done card's Claude Code transcript ran, in Weft or the
  terminal: wrap-up (`/done`, `/done-quick`) 40 points, commit (`/commit` or a wrap-up) 15, review
  (`/code-review`, `/review`, `/security-review`) 15, docs (`/architecture`, `/update-docs`, `/documentation`) 15,
  refactor (`/simplify`, `/lint-fix`, `/tech-debt`, or a refactor title) 15. Each is earned in full once every
  shipped card shows it (wrap-up, commit), 1 in 5 (review, docs) or 1 in 10 (refactor). The scan runs in the
  background on `/api/game` and re-reads a transcript only when its size changed; `~/.weft/craft.json` keeps
  `[size, habits]` per session id.
- **Class**: the top attribute's noun after the second's adjective ("Roaming Shipper").

## Badge families

`lib/game-badges.ts` holds the first families (Milestones, Streaks, Habits, Parallel, Craft's refactor pair, Code health,
Production-ready) and merges the rest, each a pure module of defs on `lib/badge-kit.ts` (the `Def` shape and counting helpers),
gathered by `lib/extra-badges.ts`. Ids never change, so moving a badge between groups doesn't announce it again.

- **Speed, Milestones, Calendar** (`lib/time-badges.ts`): idea to Done under 5 and 15 minutes, 10 ships in an hour, 20 made and
  shipped in a day, a card that sat 30+ days; 1,000 and 2,500 shipped, 1k/10k/100k turns, a 100-turn card, a one-turn ship;
  weekend, Friday after 5pm, 3am, a 14-hour day, Pi day, New Year, Halloween, Christmas, four seasons, Feb 29. Anything about
  time reads live Done events only.
- **Tokens & spend** (`lib/spend-badges.ts`): 1M to 1B tokens through your threads (`lib/usage-scan.ts` per day), a 10M day,
  a day with more out than in, a card under $0.10 or over $20, $100 and $1,000 of shipped work, a month whose cost per card fell 30%.
- **Craft, Board** (`lib/craft-badges.ts`): shipped cards whose transcripts ran /done (1, 100), a review (10), docs (25); a refactor
  and a feature in one project the same day; 50 cards in Backlog, 50 tagged. `/security-review` folds into the review habit, so
  the catalogue's Paranoid waits for a habit of its own.
- **Streaks extras, Projects, Secret, Undeterred** (`lib/more-badges.ts`): 365 and 1,000-day streaks, a freeze that saved one,
  7 ship days in a row; 10 and 25 projects, a project's first card to its tenth shipped in one day, 3 projects Production-ready,
  5 stacks shipped in; the secret Nice (69 in a week), Blaze it (4:20), The answer (42 in a day), Typo slayer; and Undeterred
  (Limits: a limit hit and 3 ships after it that day). A `secret` badge shows as ❓ Secret badge until earned (`shown()`).
- **Leagues, Social** (`lib/league-badges.ts`): promoted, Gold Thread, #1 or top 3 of a finished week, promoted the week after
  a drop, 10 weeks played; 1/5/25 builders referred, a team of 5. They read `lib/badge-facts.ts`: the `badge_facts()` RPC
  (`supabase/migrations/20261025075041_badge_facts.sql`, your league weeks with rank and size, referrals of your workspaces,
  your biggest team) on the league timer, kept in `~/.weft/badge-facts.json`. Signed out, or before the RPC is deployed, they stay locked.
- **Weft explorer** (`lib/explorer-badges.ts`): the first use of each feature, logged once (id `explore:<feature>`) by
  `recordExplore` (`lib/explore.ts`): a vault fill (`lib/secret-tools.ts`), a relay delivery (`lib/webhook-forward.ts`), a dev
  server (`lib/devserver.ts`), a pane screenshot (`lib/browser-tools.ts`), a card or app share that isn't private, a profile post
  (`lib/profile-card-sync.ts`), and each feature intro watched to the end (`lib/use-feature-intro.ts` → `POST /api/game`).
  Explorer is all of them. `explore` events earn no XP and keep no streak (`tallyDays` skips them).

## Usage and limit hits

The You tab's **Tokens, last 30 days** chart (`components/LoomUsage.tsx`) and the two limit badges come
from every Claude Code and puku-cli transcript, in Weft or the terminal, so history counts from day one.

- **The scan** (`lib/usage-scan.ts`): lists `*.jsonl` under `~/.claude/projects/*` and `~/.puku-cli/projects/*`,
  and reads each file only past the byte offset it stopped at last time, to its last full line. `~/.weft/usage.json`
  keeps, per file, that offset, the last request counted, each day's `[input, output]` tokens and the limit hits.
  It runs in the background from `/api/game`, one at a time and at most once a minute; the first scan of ~4 GB
  (1,250 transcripts) took about 15 s and saves every 200 files. A shortened file is read again from the start.
- **Tokens** (`lib/usage.ts` `readLine`): an assistant line's `input_tokens + cache_creation_input_tokens` and
  `output_tokens`, counted once per `requestId` (the CLI writes one line per content block with the same usage).
  Cache reads aren't counted; they'd dwarf everything else. Synthetic error messages carry no tokens.
- **Limit hits**: an `isApiErrorMessage` line whose text is a plan limit ("You've hit your session limit · resets
  4:10am", "weekly limit", the old "usage limit reached|<epoch>"), not the API's own "Rate limit reached".
  `limitKind` names the window: session or 5-hour → 5-hour; weekly, Opus or Sonnet caps, or a reset with a date
  or more than 5 hours away → weekly. A live Weft thread also logs one: a `rate_limit_event` with
  `status: "rejected"` (`lib/runner-turn.ts`, id `limit:<window>:<resetsAt>`, so a busy hour logs it once) and
  a plan-limit error (`lib/rate-limit.ts`, the weekly window when the card saw it at 100%).
- **One hit per window** (`distinctHits`): parallel threads all hit the same window, so hits of one kind within
  the window's length of the first, naming the same reset (or one naming none), count once.
- **Exact resets.** A live hit's event id carries the reset the SDK gave (`limit:<window>:<resetsAt>`; `liveHit` reads it), and
  `distinctHits` copies it onto the transcript hit of the same window, since the transcript's "resets 2:30am" is rounded.
- **Burn** (`lib/limit-badges.ts` `burnMs`): how long a window lasted, from when it opened (its reset minus 5 hours or 7 days)
  to the hit. A transcript reset ("2:30am (Asia/Bangkok)", "Oct 20, 9pm (…)", an epoch) is taken as the first such moment
  after the hit, in its named zone (`resetTime`). A burn outside one window's length is dropped. `/api/game`'s
  `limitHits.fastest` holds your fastest of each; the usage chart's legend shows them.
- **Badges** (the Limits group, `LIMIT_DEFS`): a ladder per window at 1, 2, 5, 10, 20, 50, 100, 250, 500 and 1,000 hits (the first
  rungs keep the old ids `limit-5h`/`limit-7d`, so nobody's ⏳/🗓️ pops up again); speed (a 5-hour window in under 2h, 1h, 30m,
  15m; a weekly one in under 3 days, 1 day); 2, 3, 4 five-hour hits in one local day; 3 and 7 days in a row; and both windows
  within a day.

### Limit records

```
/api/game limitHits ── lib/limit-board.ts limitEntry ── rpc limit_submit ──> public.limit_records (one row per account)
/api/league?board=five_hour|seven_day|five_hour_hits|seven_day_hits ── rpc limit_board ──> components/LimitBoardPanel.tsx
```

- **What goes up.** Your fastest 5-hour and weekly burn with the time each happened, and how many of each window you've
  run dry. Never prompts, code or project names. Posted on the league's 10-minute timer (`startLeagueSync`) and when a board opens.
- **The boards** are all time: fastest burn lowest first, hit counts highest first; the top 50 plus your own row, ranked with ties.
- **Bounds.** `limit_submit` drops a burn under a minute or over its window (or dated in the future) rather than clamping it,
  so a bad reading can't take first place, and clamps the counts. RLS on, no policies; both RPCs are security definer and act as
  `auth.uid()` (supabase/migrations/20261024203912_limit_records.sql).
- **Where it shows.** The 🏆 Leagues dialog's ⏱️ Limit records toggle (`components/LeaguesDialog.tsx`).

## Projects

The light request (`/api/game`, the chip) never measures; it uses cached reports. The dialog's
`&full=1` measures the project in view plus your 6 busiest repos of the last 30 days (`rootsToMeasure`),
each cached for 10 minutes. Measuring runs `measureQuality` (lib/quality.ts) plus file, `package.json`
and git lookups, about 3s for 7 repos the first time. Each measured project logs one `quality` snapshot a day,
which drives the quality XP bonus and the coverage-climber badge.

`lib/project-badges.ts` lists every check with what counts and the prompt its **Set it up** card gets.
To add one: add it to `CHECKS`, detect it in `lib/project-checks.ts`, and test both.

## The achievement popup and quiet mode

The chip keeps the badges and level it has announced in `localStorage` (`weft-game-announced`). The first
load announces nothing, so history doesn't arrive as a burst. After that, `toAnnounce` hands back the badges
just earned (`fresh`) and the new level (`levelUp`), and `components/AchievementPopup.tsx` opens over the
board: one badge gets the stage (icon, name, what earned it), several share it as a list (5 shown), a level-up
names the new level and title. A level-up opens on its rank's picture (`public/brand/levels/<rank>.webp`: Thread,
Strand, Yarn, Bolt, Loom, Tapestry), rendered by BlastCP from the splash speeder (`electron/assets/splash-speeder.jpg`)
and the woven emblem (`electron/assets/emblem.png`) as references, so every car is ours and wears the badge. Over the
picture rise its "Episode" number in roman numerals and a line of story, tilted like an opening crawl (`lib/level-lore.ts`:
a few lines per rank, the next one each level, so a rank never repeats until it runs out). A level-up's popup is a
cinema frame (16:9, up to 760 px wide, 60% of the window's height at most); a badge alone keeps the small card. A narrator
reads the line as it opens: one Kokoro clip per line in `public/brand/levels/voice/<rank>-<n>.m4a` (`Lore.voice`), made
by `pnpm levels:narrate` (`scripts/narrate-levels.mjs`, voice `bm_george`, from `loreLines()`), so change a line and
run it again; the test fails on a line with no clip. Its 🔊 is the welcome's and the feature intros' mute
(`weft-welcome-muted`, `lib/welcome-voice.ts`), so muting Weft's voice anywhere quiets it here too. The picture drifts and the
crawl rises in (`.level-hero-art`, `.level-crawl` in `app/globals.css`), and neither moves with Reduce motion on. **See your profile** opens the Wefter Profile on Badges (or You for a level-up
alone); **Nice!** and Escape close it. Behind it, `components/Confetti.tsx` throws one burst from the two lower
corners on a click-through canvas, moved by the pure physics in `lib/confetti.ts` (`burst`, `step`: drag,
gravity, terminal velocity), and draws nothing with Reduce motion on. Settings > Show progress
(`weft-show-progress` cookie) hides the chip and its popups.

The chip also keeps the last popup it opened (`weft-game-last-achievement`, `lib/achievement-replay.ts`). **Replay last
achievement**, in the avatar's menu (`components/AccountMenu.tsx`, shown while Show progress is on) and the command
palette, sends `weft:achievement-replay`, and the chip opens that popup again. Before any popup has opened, it replays
a level-up to the level you're on.

## Leagues

```
gameState() ── lib/league.ts leagueEntry() ──> { week, xp, shipped, streak, level, badges }
  └─ lib/league-sync.ts: every 10 min (startLeagueSync, from prewarm) and on opening the tab
       └─ rpc league_submit ──> public.league_weeks (one row per account per week)
/api/league ── rpc league_standings(week) ──> the caller's league ──> components/LeagueTab.tsx, the 🏆 chip (LeagueBadge.tsx)
/api/league?tier=N ── rpc league_browse(week, tier) ──> every league of a tier ──> components/LeaguesDialog.tsx
```

- **What goes up.** This week's XP (`weekXp`), cards shipped (`weekShipped`), the current streak, your level and the
  badges unlocked since Monday (`weekBadges`, icon and name only, at most 12). Never prompts, code, project names or folders.
  Your name, picture and username come from `profiles`, which sign-in already filled.
- **The week** is the Mac's own Monday (`weekOf`), so it may sit a day off UTC's; `league_submit` takes a Monday from
  8 days back to 1 day ahead and clamps every number.
- **Tiers settle lazily.** There's no Monday job: your first row of a week calls `private.league_tier_for`, which ranks
  your last row in its league and moves you up (top `min(7, ceil(n·7/30))`, only with XP and only when you weren't alone) or down
  (bottom `min(5, floor(n·5/30))`). `private.league_join` then seats you in the first league of that tier with fewer than 30,
  under an advisory lock so two joins can't take the 30th seat. `lib/league.ts` `leagueMoves`/`zoneOf` mirror those rules to
  colour the up and down zones.
- **Signing up joins.** A trigger on `profiles` enrolls a new account in the current UTC week, so a friend shows up in your league
  (at 0 XP) the day they sign up, before their Mac ever posts. It swallows its own errors: a league never fails a sign-up.
- **Access.** `league_weeks` has RLS on and no policies; both RPCs are security definer and act only as `auth.uid()`.
  `league_standings` returns only your league's rows, with `profiles.username` (else the GitHub login) for the
  `weft.zip/@username` link (docs/architecture/profiles.md). `league_browse` (20261018175456_league_browse.sql) returns every
  league of one tier, ranked within each, to any signed-in builder: the first 10 leagues (300 builders) at most.
- **Where it shows.** The header's 🏆 chip (`components/LeagueBadge.tsx`, hidden with the streak by Settings > Show progress)
  reads your league and rank and opens the Leagues dialog: the ladder as six tier buttons, opening on yours, each
  tier's leagues underneath (yours first). The Loom's League tab shows only your league, with an All leagues button.
  The dialog plays a short intro video the first time you open it (`useFeatureIntro("leagues")`, see
  [feature-intros.md](feature-intros.md)).
- **Small leagues.** With few accounts each tier holds one league, so a winner who moves up can find themselves alone; a lone
  builder doesn't move up again until someone joins.

### League emails

```
Vercel cron 13:00 UTC ──> /api/league/emails (Bearer CRON_SECRET)
  └─ lib/league-mail-send.ts runLeagueMails: league_weeks (this week, last week) + profiles + league_emails, service key
       └─ lib/league-mail.ts planLeagueMails ──> at most one email per builder
            └─ lib/league-mail-copy.ts (subject, text, Salt Flats HTML) ──> claim in league_emails ──> Resend
```

- **The series.** `welcome` any day to an account under 3 days old, once ever; `midweek` on Thursday and `final` on
  Sunday, only when a move is in play (in the up or down zone, or within `REACH_XP`, about six shipped cards, of the
  up zone; never alone in a league); `results` on Monday about the week that ended, skipped for 0 XP and no move.
  When several apply: results, then welcome, then the nudge.
- **Why 13:00 UTC.** Every time zone has finished Sunday by then (UTC-12 at 12:00), so Monday's results don't move
  after they're sent. Days are UTC; the Mac's own Monday can sit a day off, which only shifts who's counted near midnight.
  The move rule is `moveOf`, a copy of `private.league_tier_for`, so the email names the league the builder's next post lands in.
- **Once each.** `league_emails (user_id, kind, week)` is claimed before the send (a 409 means another run has it)
  and deleted if Resend refuses, so the next day's run retries. RLS on, no policies: only the service key touches it.
- **Unsubscribe.** `profiles.league_emails` (default true). Every email carries `List-Unsubscribe` +
  `List-Unsubscribe-Post` (RFC 8058 one-click) and a footer link to `/api/league/unsubscribe?u=…&t=…`, an HMAC of the
  user id under `LEAGUE_EMAIL_SECRET`. GET shows a button (so link scanners don't unsubscribe anyone); POST turns it off.
- **The button** goes to `/api/league/open`, a 302 to `weft://league`, since mail apps drop custom-scheme links.
- **Setup.** On the deployment: `CRON_SECRET`, `LEAGUE_EMAIL_SECRET`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`. Missing
  any, the route sends nothing (401 or 503). Resend's per-second limit is kept by `SEND_GAP_MS` between sends.
- **Preview.** Each kind rendered with sample data: `~/.weft/show/league-emails/index.html`.

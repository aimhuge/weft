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
checklist score and coverage) and `limit` (a plan window a Weft thread ran out of, below). Every event has a stable id, so a sync can tell what it already sent.

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
- **Badges**: ⏳ Hit the ceiling (your 5-hour limit) and 🗓️ Ran the week dry (your weekly limit), dated by the first hit.

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
names the new level and title. **See your profile** opens the Wefter Profile on Badges (or You for a level-up
alone); **Nice!** and Escape close it. Behind it, `components/Confetti.tsx` throws one burst from the two lower
corners on a click-through canvas, moved by the pure physics in `lib/confetti.ts` (`burst`, `step`: drag,
gravity, terminal velocity), and draws nothing with Reduce motion on. Settings > Show progress
(`weft-show-progress` cookie) hides the chip and its popups.

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

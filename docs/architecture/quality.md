# Code quality badge

## Overview

The header shows a code quality score for the project in view ("74% code quality", with a pie). It
never reads 100: a checklist of what Weft can measure earns 90 points, and the refactor scout, a
read-only Sonnet run that reads the code, earns the last 10, shrinking as its open findings pile up.
Hovering opens the breakdown. Clicking opens a menu that starts a card for one finding, or one card
that fixes the checklist, weakest area first.

## Key files

- `lib/quality.ts`: `measureQuality(cwd)` scores the project at the folder's git root. It reads files
  only and never runs the project's tools. Five sections, averaged over the ones that apply:
  - **Tests**: line coverage from `coverage/coverage-summary.json`, through `lib/coverage.ts`. Only a whole-suite `pnpm coverage`
    writes there: a run of named files with `--coverage` goes to the temp folder `SCOPED_COVERAGE_DIR` (`scripts/run-tests.mjs`),
    since Vitest empties its reports folder first and one file's numbers used to replace the repo's.
  - **File size**: the share of source within `MAX_LINES` (300) of the top of its file, so one
    1,200-line file costs more than a few that run a little long. Test files don't count.
  - **Lint**: how locked down the linter is (a strict preset, `--max-warnings 0`, `max-lines`, `complexity`).
  - **Types**: `strict` and friends in tsconfig, minus escape hatches (`any`, `@ts-ignore`, `eslint-disable`).
  - **Guardrails**: a pre-commit hook and a CI workflow, and whether they lint, type-check and test.
  - **Documentation**: a README, an agent guide, architecture docs, a CHANGELOG, source files that open
    with a comment, and every backticked path the root guides and `docs/architecture/*.md` name existing.
    A doc with `Status: design` (or planned, proposed) in its first 10 lines names files it plans to build, so it's skipped.
- `lib/quality-files.ts`: the file walk behind it (`projectRoot`, `listSources`, `readSources`).
- `lib/quality-view.ts`: the report's types, `tone()`, and `fixPrompt()`, the checklist card's prompt.
  Pure, so the client imports it.
- `lib/scout.ts`: runs the scout (`startScout`), caches its report per project in `~/.weft/scout/`
  with the commit it ran on, and marks findings handed to a card (`markStarted`).
- `lib/scout-view.ts`: findings, `parseFindings()`, and the score math: `headroomScore()` scales the
  checklist to 90 and adds `bandScore()`, which is `10 × 10 ÷ (10 + debt)` (high 3, medium 2, low 1 for
  each finding in the last report, started or not, until the next run), capped at 99. Pure.
- `app/api/quality/route.ts`: `GET /api/quality?cwd=…` returns `{ quality: QualityReport | null }`.
- `app/api/scout/route.ts`: `GET` returns the cached state; `POST { cwd }` re-scouts,
  `POST { cwd, started }` marks a finding as started.
- `lib/use-scout.ts`: the badge's scout hook; reads on mount and focus, polls every 20s while a run is going.
- `components/QualityBadge.tsx`: the badge and its breakdown bubble. `components/ScoutDialog.tsx`: the click dialog (on the shared `Modal`).
- `components/Tip.tsx`: the hover bubble. Native `title` tooltips don't show in Electron.
- `components/Board.tsx`: passes the folder; `improveQuality(cwd, prompt, title)` creates the card.

## Data flow

1. Board picks the folder in view: the open card's `cwd`, else the selected project, else the latest card's.
2. The badge fetches `/api/quality` for that folder, and again when the window regains focus, so a
   fresh `pnpm coverage` or a split file shows up without a reload. Results are keyed by folder,
   so switching projects never shows the previous project's numbers.
3. The scout runs on its own only for a project with no report yet. After that, `/weft:done`'s scout
   (`scout-save.mjs`) and the menu's **Re-scout** refresh it. It never runs on the start-a-card path,
   and never just because HEAD moved.
4. A menu pick starts a card in that folder: `findingPrompt(f)` for a finding (the finding is then
   marked started and leaves the open list), or `fixPrompt(q)` for the checklist (disabled for that
   folder for the rest of the session, so one click can't start two).

## Important patterns

- The project root is the folder's git root; a coverage report in a parent of the repo is never used.
- Source files come from `git ls-files` (tracked plus untracked-but-not-ignored), else a walk that
  skips dependency, build and dot folders; capped at 5,000 files and 1 MB each.
- `lib/quality.ts` builds its escape-hatch patterns from pieces so it doesn't count itself.
- Before the first scout run the band earns 0, so a fresh project reads at most 90.

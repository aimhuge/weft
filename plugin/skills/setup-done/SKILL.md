---
name: setup-done
description: Install the prerequisites /done needs on a project — a test runner with coverage, docs folders, SOUL.md/CLAUDE.md, strict lint, and the helper scripts. Audits first and only scaffolds what is missing or weak. Run once per project BEFORE /done. Use when the user says "setup done", "install done", or /done reports missing tests, docs, or lint.
argument-hint: "[project dir, default: current]"
model: sonnet
---

Prepare a project so `/done` works. `/done` runs architecture docs, bug-fix docs, lint, file sizes,
tests with coverage, then commits. Each phase needs something on disk. This skill checks for each
piece and creates only what is missing or weak.

## Rules (read first)

- **Idempotent.** Audit first. If a piece is already good, change nothing. A second run must end
  with every row `OK` and zero file changes.
- **Never overwrite user config silently.** If a file exists and needs changing (ESLint config,
  `package.json` scripts, `tsconfig.json`, `CLAUDE.md`), show the diff you propose and apply it
  as an edit that preserves the user's settings. Strengthen rules, never loosen existing ones.
  In a non-interactive run (a Weft card), apply merges that only add, and list anything that
  would change an existing value as "needs your OK" instead of applying it.
- **Never disable rules to get lint green.** No `eslint-disable`, no `@ts-ignore`, no `any`, no
  rule downgrades. Fix the violation, or list it for the user.
- Only touch the target project. Don't commit; `/done` does that. Don't push.
- Use the project's package manager (lockfile decides). Prefer `node_modules/.bin/*` over
  `pnpm`/`npm` scripts for running tools, as the `/done` helpers do.
- Content must be real, not boilerplate: seed docs from what you read in the code, and verify
  every path and name you write exists.

## Step 1: Audit

Run `${CLAUDE_SKILL_DIR}/audit.sh [project dir]`. It is read-only and prints a table of
Area / Check / Status (`OK`, `WEAK`, `MISSING`) covering the four areas below. The final report
extends it with an Action column. If everything is `OK`, skip to Step 6.

## Step 2: Testing

Skip if the runner, `test` script, `coverage` script and at least one test exist.

- **TS / JS / Next:** install Vitest and coverage: `<pm> add -D vitest @vitest/coverage-v8`.
  Copy `${CLAUDE_SKILL_DIR}/templates/vitest.config.ts` if no vitest config exists (add the
  `coverage` block to an existing one, showing the diff). Add scripts `"test": "vitest run"` and
  `"coverage": "vitest run --coverage"` (only the missing ones; if `test` exists and runs
  something else, report it). Add `@vitejs/plugin-react` and `jsdom` only if the project has
  component code worth testing.
- **Existing Jest:** keep Jest. Add only the missing `coverage` script (`jest --coverage`).
  `/done`'s `tests.sh` falls back to `<pm> test` for non-vitest runners.
- **Python:** install `pytest pytest-cov` with the project's tool (uv, poetry, pip), record them
  as dev dependencies, create `tests/test_sample.py`, and document `pytest --cov` as the
  coverage command.
- **Sample test:** if no test file exists, write one that tests a real pure function from the
  project when there is an obvious one; otherwise copy `templates/sample.test.ts` next to the
  code, matching the project's test location convention.
- Run the suite once to prove it passes.

## Step 3: Docs

Create only the missing items. Never touch existing docs.

- `docs/architecture/`: create `overview.md` from `templates/architecture-overview.md`, filled in
  from the real code (entry points, directory layout, README).
- `docs/bug-fixes/`: create with `README.md` from `templates/bug-fixes-README.md`.
- `SOUL.md`: if missing, write a minimal one from `templates/SOUL.md`, with purpose, values and a
  short map of the big pieces filled in from the README and code. Mark guesses with `<confirm>`.
  It is loaded into every thread, so keep it small: per-file detail goes in `docs/architecture/`.
- `CLAUDE.md`: if missing, create it from `templates/CLAUDE.md` (just `@SOUL.md`). If it exists
  without the include, show a diff that adds `@SOUL.md` as the first line.

## Step 4: Lint, tightened

Applies to TS/JS projects. (Python: add `ruff` with `select = ["E","F","I","B","C90","UP","SIM"]`
and a `lint` script, same rules.)

1. **ESLint:** install `eslint @eslint/js typescript-eslint eslint-plugin-react-hooks` as dev
   dependencies (skip react-hooks, and drop it from the config, if the project has no React; for
   Next.js keep existing `eslint-config-next` entries and merge). Use
   `templates/eslint.config.mjs`. If a config exists, merge the strict blocks into it and show
   the diff; keep the user's ignores and plugins. Limits: `complexity` 15, `max-lines` 500,
   `max-lines-per-function` 120, `max-depth` 4, `max-params` 5, plus `no-explicit-any`,
   `no-unused-vars` and `react-hooks` as errors.
2. **tsc strict:** in `tsconfig.json` set `"strict": true`, and add `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch` if absent. Show the diff first. Add a
   `"typecheck": "tsc --noEmit"` script if missing.
3. **Scripts:** `"lint": "eslint ."` if missing. If `lint` exists and runs something else, keep it
   and report.
4. **Violations:** run `node_modules/.bin/eslint .` and `node_modules/.bin/tsc --noEmit` (or `tsc-once`, when it's
   on PATH, so it takes turns with other threads' checks).
   - Fix mechanical ones (unused imports and variables, `any` with an obvious type, hook
     dependencies, `let` to `const`). Re-run after.
   - List the rest grouped by rule with counts and the worst files. Do not disable rules and do
     not weaken limits to hide them. If more than about 50 remain, fix none beyond the mechanical
     ones; hand the user the list so they can decide on a cleanup card.

## Step 5: Helper scripts

`/done` calls `lint.sh`, `tests.sh`, `scout-facts.sh`, `scout-save.mjs` (plus `session-stats.sh`,
`gather-context.sh`, `commit.sh`) through its own `${CLAUDE_SKILL_DIR}`. The audit checks they sit
beside `/done`: normally `../done/` in this plugin, or `.claude/skills/done/` in the project.

- Scripts present: nothing to do.
- Project has its own `.claude/skills/done/` missing some: copy the missing ones from
  `${CLAUDE_SKILL_DIR}/../done/` (never overwrite existing ones) and `chmod +x`.
- `/done` not installed at all: say so, and where to get it (`fotoflo/claude-skills`, or Weft's
  plugin).

## Step 6: Verify and report

1. Re-run `${CLAUDE_SKILL_DIR}/audit.sh`. Everything created must now read `OK`. Remaining `WEAK`
   rows are things you reported as needing the user's OK.
2. Run the project's test and lint commands once more.
3. Print the final audit table, for example:

```
setup-done audit
-----------------------------------------------------------
Area      Check             Found      Action
-----------------------------------------------------------
Testing   runner            MISSING    installed vitest + coverage-v8
Testing   test files        MISSING    added lib/sample.test.ts
Docs      architecture/     MISSING    created overview.md
Docs      SOUL.md           OK         unchanged
Lint      eslint config     WEAK       merged strict rules (diff shown)
Lint      violations        -          12 fixed, 31 listed, 0 disabled
Scripts   lint.sh           OK         unchanged
-----------------------------------------------------------
```

4. List files created or changed, any "needs your OK" diffs, and remaining lint violations.
5. If no `MISSING` rows remain and the tests pass, end with: **`/done` is ready.** Otherwise say
   what blocks it. Don't commit; `/done` will.

On a Weft card, report `column=review` when something needs the user's OK or violations remain,
and `column=done` when the audit is fully `OK`.

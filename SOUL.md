# SOUL.md: who I am

I am Weft, a desktop kanban board where every card is a Claude Code, puku-cli or Codex thread, with a
browser pane beside the board and a copilot that runs the board. The weft is the thread that crosses
the loom and binds separate threads into cloth; I bind your agent threads into work.

I am built for builders and product managers: the ultimate creation tool. You bring the idea; I run
the threads that plan it, build it, show it in the browser pane and walk you through the review.

If you are an agent editing this repo, you are working on me. Read README.md for features.

## What I value

- **Speed first.** Claude Code and puku-cli are warm and pre-started (spares, keep-alive), so a reply starts in ~2s.
  Codex starts one CLI process per turn and resumes its saved session. Never add work to the start-a-card path without measuring it.
- **No git worktree per card, on purpose.** Worktrees cost a fresh checkout, `npm install` and env
  setup per card, and leave stray folders behind (like `fervent-tu-abd214`). I prefer cheap safety:
  busy-folder and overlap warnings.
- **Screen space is precious.** The user runs me maximized on a 13" MacBook Air (~1280x800 pt),
  often with the browser pane and thread panel open, leaving the board a few hundred px. Never add
  rows or chips just to show structure; fold it into existing controls (menus, counts, badges).
  Check the live window size before designing UI: `~/Library/Application Support/Weft/*-window.json`.
- **I'm always showing you something, every turn.** The browser pane is never idle and never stale.
  Every reply, even a one-line answer, leaves something current for that turn in the pane: the app,
  a web page, or an HTML page the thread writes itself (commits, plans, diffs, test runs, answers).
  The rule lives in `BROWSER_PROMPT` (`lib/browser-tools.ts`); `lib/show.ts` backs it up with a
  starter page and a Haiku-written update page when a turn showed nothing.
- **I fix myself.** Every thread working in me should be looking for ways I could be better. When
  you spot one, you may start a card to fix it without asking: call `mcp__board__list_cards`
  first to avoid a duplicate, then `mcp__board__create_card` (it starts the card in the thread's
  folder by default). Tell the user you did.
- **Growth mindset.** I'm good and I get better. I follow Refactoring, 2nd ed. (Fowler):
  - tests before refactoring; small behavior-preserving steps
  - "make the change easy, then make the easy change"
  - name the smell (Long Function, Large Class, Duplicated Code, Feature Envy) before fixing it
  - the 300-line `max-lines` cap and the per-file ratchet in `eslint.config.mjs` are there to force that refactor.
    A file at its cap gets code moved out (Extract Function or Module) and its number lowered; never joined lines,
    dropped blank lines or deleted comments, which only hide the smell
  - hotspots, and what has already moved out of them: docs/architecture/MAP.md#hotspots
  - tests sit beside the code (`pnpm test`, ~3,500 Vitest tests, every line of `lib/` and `app/api/` covered); keep new
    lib code at 100% and add tests with any risky change to the untested `components/` and `electron/` (docs/architecture/MAP.md#tests)

## Where things live

The full file map is docs/architecture/MAP.md, with one doc per feature beside it in docs/architecture/. Read
the entry for what you're changing before you change it. The big pieces:

- `electron/`: the desktop shell (main, windows, tray, dock, `weft://` links, the native browser pane and its
  token-guarded control server on 127.0.0.1, the 🔐 vault, the provider drawers' Keychain sides).
- `lib/runner.ts`: one Agent SDK `query()` per Claude Code or puku thread; Codex is `lib/codex-runner.ts`, Goose
  `lib/goose-runner.ts`. `lib/env.ts` `guardedCli()` is every CLI's env and its Bash and edit guards (docs/architecture/thread-guards.md).
- `components/Board.tsx`: the board screen; its hooks in `lib/use-*.ts`, its pure logic in `lib/board-*.ts` (docs/architecture/board.md).
- `app/api/*`: the server's routes, behind `lib/guard.ts`; the board calls them through `lib/api-client.ts`.
- `lib/store.ts`: storage in `~/.weft` (board.json, threads/, attachments/).
- `plugin/skills/*`: my own skills (`/weft:done`, `/weft:commit`, `/weft:preview`, `/weft:setup-done`).
- `app/[orgSlug]/*`, `app/s`, `app/a`, `app/u`, `app/home`: weft.zip, the deployed side (teams, the web board, share links, profiles, the home page).

## Using my secret store

The 🔐 on the left rail is a vault per project (keyed by its GitHub repo): values encrypted on disk, decrypted only
in Electron main, revealed or copied only after the user's Touch ID (docs/architecture/secrets.md).

- **A secret's value never enters your context.** Work with names (`GITHUB_CLIENT_SECRET` in the weft vault); I put
  values in at the edge. A value you've seen is in the model request and in plaintext transcripts for good.
- **When a task needs a value** (a provider's client secret into Supabase, a key into a dashboard): fill it in yourself,
  never ask the user to paste it. `mcp__secrets__list` gives the names in the card's vault (or another project's, by
  path); open the page with the field in the browser pane, then `mcp__secrets__fill_field(name, selector)`. Electron main
  asks for Touch ID (naming the secret, vault and site; then 3 free minutes for that card on that site), types the value
  in and masks the field; `read_page` shows it as `‹NAME›`. https pages only. Built in `lib/secret-tools.ts`,
  `electron/pane-secrets.cjs` and `vault.useFor()` in `electron/vault.cjs`.
- **Never go around it.** Don't read `.env*`, `~/.weft/vault/` or `~/.weft/device-key.json` (`lib/secret-guard.ts` denies
  them), and never write a script that loads the vault modules or `safeStorage` outside the app: that skips Touch ID
  even if it prints nothing.
- **When a command needs a value** (`pnpm run job` or a migration with `DATABASE_URL`, a CLI with an API token): call
  `mcp__secrets__run(command, names)`. The user approves the exact command, its `package.json` script and the names
  (once or always), main runs it with no shell and the values in its env only, and you get the exit code and output with
  each value as `‹NAME›`. One plain command: no pipes, redirects, `&&` or `$VAR` (put steps in a package.json script);
  shells, `node -e`, `printenv` and network tools are refused. Built in `lib/secret-run.ts` + `lib/secret-command.ts`
  and `electron/secret-run.cjs` (with `run-rules.cjs`, `secret-redact.cjs`). A card's dev server gets the development
  values through `electron/secret-env.cjs`. Values for HTTP requests (a Management API header) aren't built yet: say
  what's missing and ask.
- **When code needs a secret**: read it from `process.env.NAME` and add `NAME=` to `.env.example`, so the vault lists it as
  missing until the user fills it with 🔐 Add.
- **If the user pastes a key into the thread**: say it's now in the transcript, suggest rotating it at the provider,
  and keeping the new one in the vault.

## Conventions to keep

- End every board-thread reply with the BOARD STATUS line the thread prompt asks for; don't change
  its format without updating `lib/status.ts`.
- This Next.js differs from your training data: read `node_modules/next/dist/docs/` first.
  Leave the managed block in AGENTS.md alone.
- Run me in dev mode (`pnpm desktop`, or the `~/Applications/Weft.app` launcher, which opens
  Electron on this folder). Run `pnpm dist` only to ship a build to someone else; a local
  packaged `.app` goes stale with every commit.
- When a feature lands, update README.md, docs/ROADMAP.md and its entry in docs/architecture/MAP.md in the same change, and record it with `mcp__board__changelog_add`
  (`changelog_list` first, to edit your own entry instead of adding a second). Never edit CHANGELOG.md's Unreleased by hand:
  every card used to, and the whole-file claim made them wait on each other; Weft writes and commits it after your commit.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` (Vitest; tests sit beside the code as `lib/*.test.ts` and `components/*.test.tsx`, the latter in jsdom with `// @vitest-environment jsdom` and `./test-utils`; API routes in `app/api/routes.test.ts`).
  `pnpm typecheck` and `pnpm lint` take turns across cards (`scripts/one-at-a-time.mjs`, as does the pre-commit hook's tsc);
  `lib/check-guard.ts` refuses `npx tsc` or bare `eslint`. To lint only your own files, `pnpm lint <files>`.
- A whole-suite `pnpm test` is memory-guarded twice over, because a sweep at the core count used to take Weft
  down with it: `scripts/test-memory.mjs` refuses to start one with under 2 GB genuinely free, and
  `scripts/test-watchdog.mjs` ends the run if the vitest process tree's real RSS crosses 3072 MB
  (`WEFT_TEST_MAX_RSS_MB`). Both are bypassed by a run of named files, which is what a thread should do:
  `pnpm test lib/x.test.ts`. Never call `scripts/run-tests.mjs` bare to "check" something — that starts a real
  sweep. Vitest's own `vmMemoryLimit` is not one of these guards: it is a no-op on `pool: "forks"`, reads a
  bare number as bytes, and only measures V8's `heapUsed` after each file, so it cannot see off-heap growth.
- Stage every new file a change imports. The pre-commit hook (`.githooks/pre-commit`, set up by
  `pnpm install`) type-checks the staged files alone and refuses a commit that imports an unstaged
  file. Never `git stash` in this tree: other threads' unstaged work lives here too.
- Weft uses pnpm (node-linker=hoisted in .npmrc, so node_modules stays flat for Electron); never
  run npm install here.
- Every board-side fetch goes through `lib/api-client.ts` (`apiFetch`, `API_HEADERS`) so it carries `x-weft-token`;
  a fetch without it 403s and its `.catch()` silently empties a whole feature. `lib/api-token-guard.test.ts` checks.
- The weft.zip board is the desktop's own board over a different transport (`lib/thread-transport.ts`), not a lookalike:
  change the desktop board and the web follows. New thread-view code reads the transport, never `fetch`/`api` directly.
- Never pass the teams gate's `service` client to a client component (docs/architecture/teams.md).
- SOUL.md stays small (`lib/soul-size.test.ts` caps it): a new feature's details go in docs/architecture/MAP.md
  and its own doc; this file changes only for who I am, a value or a convention.

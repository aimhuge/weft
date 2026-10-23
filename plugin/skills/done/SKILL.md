---
name: done
description: Wrap up a coding session — scout it for refactors, update docs, test, then commit and push. Weft runs it when you move a card to Done. Use when the user says "done", "wrap up", or "finish".
argument-hint: "[optional commit message]"
model: sonnet
---

Wrap up the current coding session: commit it, document it, and scout it for what to improve next.

## On a Weft card

Weft runs this in the card's own thread when the user moves the card to Done, so the session is this
thread's conversation. Moving a card to Done means "commit, push and deploy this". Nobody is watching
the turn: never end it with a question or a menu of options ("Pick one: …"). Decide, do it, report.
Committed, pushed and deploying (or nothing to deploy) → `column=done`; tests fail, lint errors remain
in your own code, or the push or deploy check fails → `column=review` with what's left (Weft keeps a
Review wrap-up on the board instead of archiving it). Show the wrap-up in the browser pane, not as ASCII art.

Every `Agent` call names its `model`: `"haiku"` on Claude Code, `"puku-ai-2.8"` on puku-cli (which
refuses any model outside its pinned `puku-ai-2.7`, `puku-ai-2.8`, `opus`). An agent without one
inherits the parent's model, and a 1M-context parent bills 1M-context credits.

**Scripts measure; agents judge.** Anything countable runs in a script in seconds. Spend model turns
only on what a script can't do: write docs, read failures, decide what's worth refactoring.

## Session files

Several sessions may share this branch and working tree, so git history (`HEAD~3`, a broad
`git diff`) is not a reliable list of this session's work. Use your memory of the conversation:
every file you edited, created or wrote. That list is the "session files" below.

## Phase 0: Context (you, ~5s)

1. Compile the session files.
2. Run `${CLAUDE_SKILL_DIR}/gather-context.sh` (diff stats, existing docs, uncommitted files).
3. Run `${CLAUDE_SKILL_DIR}/lint.sh <session files>` and fix what it reports in session files
   yourself. The pre-commit hook lints staged files, so the commit won't pass without it.
4. Run `${CLAUDE_SKILL_DIR}/scout-facts.sh <session files>` and keep its output for the scout.
5. Note whether a bug was fixed this session (for the bug-fix doc).

## Phase 1: One Puku batch (parallel, a few minutes)

Run the agents below on the Puku gateway through the `puku-agent` skill: free, no Anthropic tokens,
and their file reads stay out of your context. Fall back to the Agent tool (with the model above) only
when `~/.claude/skills/puku-agent` is missing or the batch fails on credentials. A failed batch is not
a no-op: read `summary.json`, and when every task is `error`, say why and fall back.

1. Make this run's scratch folder: `${CLAUDE_SKILL_DIR}/scratch.sh new` prints `<dir>`, a fresh
   `~/.weft/done/run-XXXXXX/` with an empty `out/`. Every file below goes there, never in the project
   (not the skill folder, not `.done-batch/` or `.scratch/`): repo scratch files show up in the commit
   pile, and wrap-ups running at once would overwrite each other's notes.
2. Write one prompt file per agent in `<dir>`. Each holds the session file list, a paragraph on WHAT
   changed and WHY (the agents can't see this conversation), and its instructions below.
3. Write `<dir>/tasks.json` beside them (absolute `prompt_file` paths):
   ```json
   [
     {"id": "docs",  "model": "opus-4.8", "tools": "write", "prompt_file": "<dir>/docs.md"},
     {"id": "scout", "model": "opus-4.8", "tools": "bash",  "prompt_file": "<dir>/scout.md"},
     {"id": "tests", "model": "opus-4.8", "tools": "bash",  "prompt_file": "<dir>/tests.md"}
   ]
   ```
4. From the repo root, in the background:
   `node ~/.claude/skills/puku-agent/puku-agent.mjs --batch <dir>/tasks.json --out <dir>/out --workdir . --quiet`
5. When it finishes, read `<dir>/out/summary.json` and each `<dir>/out/<id>.md`.

### docs agent

1. For each feature area the session files touch, update its doc in `docs/architecture/` (or create
   one in the style of its neighbours): overview, key files, data flow, important patterns.
   Document the current state, not the history. Skip trivial changes.
2. Only if a bug was fixed (you'll say so in the prompt, with symptom, root cause and fix): add
   `docs/bug-fixes/NNN-short-description.md` (next number) with date, severity, symptom, root cause,
   the fix with before/after snippets, a one-line key rule, and the files involved.
3. Report what it created or updated.

### scout agent

Give it the `scout-facts.sh` output. Its job is judgment, not measurement:

1. Read the session files and the code they call or duplicate.
2. Find up to 8 things most worth changing next, worst first:
   - a smell named Fowler-style (Long Function, Duplicated Code, Feature Envy, Primitive Obsession,
     Shotgun Surgery, Data Clumps…) at file:line;
   - a lint rule worth turning on, or a per-file lint override the facts say may now be removable;
   - a loose type: a plain `string` where a union fits, `as` casts, optional fields that are always set;
   - a risky change with no test.
3. Don't edit anything. Write the findings as a JSON array to `<dir>/out/findings.json`, each
   `{"file", "line", "smell", "category": "refactor|lint|types|tests|guardrails", "severity":
   "high|medium|low", "fix"}`. `fix` is one sentence saying what to change, specific enough to be a
   card's prompt ("Extract the permission check out of startTurn into canUseTool() in
   lib/permissions.ts").
4. Report the top three in a line each.

### tests agent

1. Run `${CLAUDE_SKILL_DIR}/tests.sh <session files>` (vitest: only the related tests).
2. Don't edit files. Report files, passed, failed, duration; for each failure the test name, the
   first lines of the error, and the likely cause at path:line.

## Phase 2: Verify (you)

The reports are leads, not facts:
- **Lanes.** `git status --short`: docs may touch only `docs/architecture/` and `docs/bug-fixes/`;
  scout and tests touch nothing. Restore anything outside those lanes unless it's a fix you'd make.
- **Docs.** Read every doc diff and check each path, function name and number against the code.
- **Tests.** A failure report tells you where to look; fixing it is your job.
- **Scout.** Drop findings that are wrong or trivial, then run
  `node ${CLAUDE_SKILL_DIR}/scout-save.mjs <dir>/out/findings.json <session files>`. It merges them
  into the report Weft's quality badge reads, where each finding can start a card.

## Phase 3: SOUL.md (you)

Only if the project has one, and only when this session changed what it states: the file map, values
or conventions, hotspot sizes, the "Known gaps" list (refresh its verified date), or test/CI status.
First person, the file's terse style, current state only. No `SOUL.md` → say `/weft:setup-done`
can create one.

## Phase 4: Commit, push, deploy (you)

1. Message: conventional commits; `$ARGUMENTS` as the first line if given. Body: what changed and
   why, in a few lines. End with the session's Co-Authored-By line.
2. `${CLAUDE_SKILL_DIR}/commit.sh "message" file1 file2 ...` with exactly: the session files, the
   docs and lint fixes you verified, `SOUL.md` if it changed. It `git add`s each path and commits
   only those paths, so other sessions' staged work stays out.
   - **Shared files go whole.** A session file other cards also edited (README.md, CHANGELOG.md,
     docs/ROADMAP.md, SOUL.md, a shared component) is committed whole, their lines with yours. Their
     lines ship a little early; that's fine, and the pre-commit hook still checks them. Name those
     files in the report. Never leave your own lines behind to dodge theirs.
   - Never a temp index (`GIT_INDEX_FILE`), hunk-picking, `git apply --cached` or a commit script of
     your own: they skip or fight the hook.
   - The hook fails on another card's unfinished code in a shared file: drop just that file, commit
     the rest, and end with `column=review`, `remaining=commit <file> after <card>`.
   - Nothing of yours left to commit (another card or commit already took it): say so and go on.
3. `${CLAUDE_SKILL_DIR}/push.sh`, after a clean commit and also when there was nothing to commit. It
   follows Weft's "Push on Done" setting (on by default) and pushes the branch with a plain
   `git push`; carrying commits other sessions made on it is intended, never a reason to skip. It
   exits 0 when it pushed or skipped on purpose (setting off, no remote); report which. A failed
   push (rejected, offline, auth) keeps the commit local: don't force, pull, rebase or retry; say why
   and end with `column=review`, `remaining=push by hand`.
4. After the push: `node ${CLAUDE_SKILL_DIR}/deploy.mjs`, in the background (Bash `run_in_background`):
   it waits for the build, ~15 min for Weft. Write the report page meanwhile and finish it when the
   result arrives. With a Vercel link (`.vercel/project.json`) the push is the deploy, and it checks
   that it went out: the project deploys from origin's repo (by id, so a renamed or re-created repo
   is caught), git deploys are on, and the deployment of HEAD finishes, waiting behind deploys
   already running. Never run `vercel deploy` from this tree: it uploads other cards' uncommitted work.
   - **Exit 0:** deployed (its url), or nothing to deploy and why. Report it.
   - **Exit 3, the build failed:** production is still on the last good deploy. Read the log tail it
     printed (`vercel inspect --logs <url>` for more). When the cause is in this session's files,
     or a plain build fix (a missing import, a type error, a file not committed), fix it, run the
     related tests, commit with `commit.sh`, `push.sh`, and run `deploy.mjs` again: at most two
     rounds. Still failing, or the cause is another card's work: start a card to fix the build
     (`mcp__board__list_cards` first, then `mcp__board__create_card` with the url and the error) and
     end with `column=review`, `remaining=build fails: <error, a few words>`.
   - **Exit 2:** pushes don't deploy (the link), it was canceled, or it's still building after 30
     min. Report its line and fix, and end with `column=review`, `remaining=fix deploy`.

## Phase 5: Report (you)

Write the report page outside the project too (e.g. `~/.weft/show/`), then remove this run's scratch
folder: `${CLAUDE_SKILL_DIR}/scratch.sh clean <dir>` (it only deletes a `~/.weft/done/run-*` folder; a
run that dies before this is pruned by the next `new` after a day).

Show it in the browser pane as one HTML page, and say it in a few lines: the commit (hash, files,
+/- from `${CLAUDE_SKILL_DIR}/session-stats.sh <session files>`), pushed or not and why, the deploy (url, or why not), tests passed/failed, docs touched,
SOUL.md change, and the scout's top three with their fixes.

End the report with the goodbye banner, on its own lines: the literal line
"Committed, refactored, deployed and done," followed by a short snarky poem — four lines,
rhyming or near-rhyming, in the voice of the work just done. Plain ASCII only
(`+ - | = * # / \`, letters, digits); no Unicode box-drawing, block elements, braille or arrows.
The banner is the sign-off, the unmistakable "this is finished" marker you can spot from
across the room while scrolling back, without reading a word.

## Rules

- Never `--no-verify`, `--amend`, force push, a bare `git commit`, `git reset` or `git stash`;
  other sessions share this index and tree.
- Fix lint only in session files; no codebase-wide cleanup. The scout reports, it doesn't fix.
- Never write scratch files (prompts, tasks.json, reports, scripts) inside the project; use `<dir>`.
- Never commit `.env`, secrets or credentials. Push only through `push.sh`, which honors the setting; deploy only by that push (`deploy.mjs` checks it).

---
name: done
description: Wrap up a coding session — test, update docs, scout big changes for refactors, then commit and push. Weft runs it when you move a card to Done. Use when the user says "done", "wrap up", or "finish".
argument-hint: "[optional commit message]"
model: sonnet
---

Wrap up the current coding session: check it, document it, commit, push and deploy it.

## On a Weft card

Weft runs this in the card's own thread when the user moves the card to Done, and it runs on nearly
every card, so keep it fast. Moving a card to Done means "commit, push and deploy this". Nobody is
watching: never end with a question or a menu. Decide, do it, report.
Committed, pushed and deploying (or nothing to deploy) → `column=done`; tests fail, lint errors remain
in your own code, or the push or deploy check fails → `column=review` with what's left. Never
`column=needs_you`: a wrap-up is archived whatever it asks.

**Scripts measure; you judge.** Run scripts for anything countable. Most cards need no sub-agent at all.

## Session files

Several sessions share this branch and working tree, so git history and a broad `git diff` don't tell
you what this session did. Use your memory of the conversation: every file you edited, created or
wrote. That list is the "session files".

## Phase 1: Check (you, in parallel)

1. Start `${CLAUDE_SKILL_DIR}/tests.sh <session files>` in the background (Bash `run_in_background`):
   it runs only the tests related to them, and nothing when there are none.
2. Run `${CLAUDE_SKILL_DIR}/lint.sh <session files>` and fix what it reports in session files. The
   pre-commit hook lints staged files, so the commit won't pass without it.
3. When the tests finish, fix failures in session files yourself. A failure in another card's code
   isn't yours: name it and go on.

## Phase 2: Docs and changelog (you)

- **Docs.** For each feature area the session changed in a way a reader would notice, update its doc
  in `docs/architecture/` (and its MAP.md entry): current state, not history. Skip trivial changes.
  You built it, so write it yourself. When the session spans three or more feature areas, hand the
  docs to one `Agent` (see "Sub-agents") and check its paths and names against the code.
- **Bug-fix doc.** Only for a bug a future reader could hit again: `docs/bug-fixes/NNN-short.md`
  (next number) with symptom, root cause, fix and the one-line rule, like its neighbours.
- **Changelog.** If the session shipped something a user would notice: `mcp__board__changelog_list`,
  then `changelog_add` (or `changelog_edit` your own) before the commit. Never edit CHANGELOG.md; leave
  it out of your commit. (Outside Weft, with no such tool: add the line under Unreleased.)
- **SOUL.md** only when the session changed who the project is, a value or a convention. Feature
  details go in MAP.md and the feature's doc.

## Phase 3: Scout (only for big changes)

Skip it, and say "scout skipped (small change)", unless the session added or rewrote over ~150 lines
of non-test code, or added a new module. Small cards are covered by Weft's standing scout report.

When it runs:
1. `${CLAUDE_SKILL_DIR}/scout-facts.sh <session files>` (measurements for the agent).
2. One `Agent` (see "Sub-agents") with the session files, a paragraph on what changed and why (it
   can't see this conversation) and the facts. It reads the session files and the code they call,
   edits nothing, and replies with only a JSON array of up to 8 findings, worst first:
   `{"file", "line", "smell", "category": "refactor|lint|types|tests|guardrails", "severity":
   "high|medium|low", "fix"}`. Smells are named Fowler-style (Long Function, Duplicated Code, Feature
   Envy…), or a lint rule worth turning on, a loose type, a risky change with no test. `fix` is one
   sentence specific enough to be a card's prompt.
3. Drop findings that are wrong or trivial. Write the rest to `<dir>/findings.json`, run
   `node ${CLAUDE_SKILL_DIR}/scout-save.mjs <dir>/findings.json <session files>` (it feeds Weft's
   quality badge, where each finding can start a card).

### Sub-agents

`<dir>` is this run's scratch folder: `${CLAUDE_SKILL_DIR}/scratch.sh new` prints it, never inside
the project. Remove it when the report is written: `${CLAUDE_SKILL_DIR}/scratch.sh clean <dir>`.

**Puku first, when it's there.** If `~/.claude/skills/puku-agent/puku-agent.mjs` exists, run the agent
on the Puku gateway (free, no Anthropic tokens): write its prompt to `<dir>/<id>.md` and
`<dir>/tasks.json` as `[{"id": "<id>", "model": "opus-4.8", "tools": "write" or "bash",
"prompt_file": "<dir>/<id>.md"}]`, then from the repo root
`node ~/.claude/skills/puku-agent/puku-agent.mjs --batch <dir>/tasks.json --out <dir>/out --workdir . --quiet`
and read `<dir>/out/summary.json` and `<dir>/out/<id>.md`.

**Sonnet otherwise.** No puku-agent (most users), or the run comes back `error` (credentials, gateway
down): use the `Agent` tool and always name its `model`: `"sonnet"` on Claude Code, `"puku-ai-2.8"` on
puku-cli (it refuses other models). An agent without one inherits the parent's model and its context
billing. Say in the report which one ran.

## Phase 4: Commit, push, deploy (you)

1. Message: conventional commits; `$ARGUMENTS` as the first line if given. Body: what changed and
   why, in a few lines. End with the session's Co-Authored-By line.
2. `${CLAUDE_SKILL_DIR}/commit.sh "message" file1 file2 ...` with exactly: the session files and the
   docs and lint fixes you made. It `git add`s each path and commits only those paths, so other
   sessions' staged work stays out.
   - **Shared files go whole.** A session file other cards also edited (README.md, docs/ROADMAP.md,
     a shared component) is committed whole, their lines with yours; the hook still checks them.
     Name those files in the report. Never leave your own lines behind to dodge theirs.
   - Never a temp index (`GIT_INDEX_FILE`), hunk-picking, `git apply --cached` or a commit script of
     your own: they skip or fight the hook.
   - The hook fails on another card's unfinished code in a shared file: drop just that file, commit
     the rest, and end with `column=review`, `remaining=commit <file> after <card>`.
   - Nothing of yours left to commit (another card already took it): say so and go on.
3. `${CLAUDE_SKILL_DIR}/push.sh`, after a clean commit and also when there was nothing to commit. It
   follows Weft's "Push on Done" setting and pushes the branch with a plain `git push`; carrying other
   sessions' commits is intended. Exit 0 means pushed or skipped on purpose (setting off, no remote);
   report which. A failed push keeps the commit local: don't force, pull, rebase or retry; say why
   and end with `column=review`, `remaining=push by hand`.
4. After the push: `node ${CLAUDE_SKILL_DIR}/deploy.mjs` in the background (it waits for the build).
   Write the report meanwhile. With a Vercel link the push is the deploy; it checks the project
   deploys from origin's repo and that HEAD's deployment finishes. Never run `vercel deploy` from
   this tree: it uploads other cards' uncommitted work.
   - **Exit 0:** deployed (its url), or nothing to deploy and why.
   - **Exit 3, the build failed:** production stays on the last good deploy. Read the log tail
     (`vercel inspect --logs <url>` for more). When the cause is in this session's files or a plain
     build fix, fix it, run its tests, `commit.sh`, `push.sh`, `deploy.mjs` again: at most two rounds.
     Otherwise start a card to fix the build (`mcp__board__list_cards` first, then
     `mcp__board__create_card` with the url and error) and end with `column=review`,
     `remaining=build fails: <error, a few words>`.
   - **Exit 2:** pushes don't deploy, it was canceled, or still building after 30 min. Report its
     line and end with `column=review`, `remaining=fix deploy`.

## Phase 5: Report (you)

One HTML page outside the project (e.g. `~/.weft/show/`), shown in the browser pane, and a few lines
in the reply: the commit (hash, files, +/- from `${CLAUDE_SKILL_DIR}/session-stats.sh <session
files>`), pushed or not, the deploy (url, or why not), tests passed/failed, docs touched, and the
scout's top three (or that it was skipped).

End with the goodbye banner on its own lines: the literal line "Committed, refactored, deployed and
done," then a four-line snarky poem in the voice of the work. Plain ASCII only.

## Rules

- Never `--no-verify`, `--amend`, force push, a bare `git commit`, `git reset` or `git stash`;
  other sessions share this index and tree.
- Fix lint only in session files; no codebase-wide cleanup. The scout reports, it doesn't fix.
- Never write scratch files inside the project.
- Never commit `.env`, secrets or credentials. Push only through `push.sh`; deploy only by that push.

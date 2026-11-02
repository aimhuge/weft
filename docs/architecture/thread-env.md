# What a thread knows each turn: the `<weft-env>` block

Every message Weft sends a board thread's CLI starts with a short block saying which machine runs the card, where
the message came from and what time it is. The thread sees it; the user doesn't.

```
<weft-env>
host: Weft Worker mini-1, Linux 6.8.0 (x64), Weft 0.7.0 @ d83e363, 103 commits behind origin/main as of 22:04
from: the desktop board on Mac m1mini over the session line
time: user Mon 2026-11-02 22:09 Asia/Bangkok (UTC+07:00); host 15:09 UTC (UTC+00:00)
</weft-env>
```

On a Mac, from its own board:

```
<weft-env>
host: your Mac (m1mini), macOS (Darwin 25.3.0, arm64), Weft 0.7.0 @ d83e363, 9 commits behind origin/main as of 22:08
from: the desktop board on this Mac (m1mini)
time: Mon 2026-11-02 22:08 Asia/Bangkok (UTC+07:00) (the user's and the host's)
</weft-env>
```

## Why

A thread on a Weft Worker wrote "19:00" on a progress page at 17:23, didn't notice its worker was 103 commits behind
main, and couldn't tell whether the user was at the desktop, on weft.zip or on the phone. The system prompt is fixed for
a warm session (a spare starts before the card exists), so facts that change per turn ride on the turn.

## How it works

```
 entry point                 noteClient(card, client)          runner                       CLI
 ───────────                 ─────────────────────────         ──────                       ───
 POST /api/cards/:id/messages  desktop, here (or "local")  ─┐
 POST /api/cards               body.client, same            │   sendMessage / steer
 cloud_commands reply / host   row's payload.client hint    ├─▶ turnEnv(card, text) ──▶ "<weft-env>…</weft-env>\n\n" + text
 new_card / card.create        body.client from the row     │     takeClient(card)
 line verb (worker)            line command's hint, "line"  │     ?? impliedClient(card): cron, another card, Weft itself
 scheduler (Send later)        "scheduled"                  │   + hostFacts() (cached)
 Slack inbound                 "webhook (Slack)"           ─┘   + clock(now, user tz) / clock(now, host tz)
```

- **Host** (`lib/host-facts.ts`): "your Mac (<hostname>)" or "Weft Worker <enrolled name>" (`setWorkerName` at daemon
  start), the OS, Weft's version from `package.json` (a packaged build's `NEXT_PUBLIC_APP_VERSION`), and the commit and
  behind count from one async `git rev-parse` and `git rev-list --count HEAD..origin/main` (`warmHostFacts`, called from
  `GET /api/cards` on a Mac and from `scripts/weft-worker.ts start`). Nothing fetches per turn: a worker's update loop
  already fetches main and reports the distance through `noteUpstream` (`lib/worker-update.ts` survey); a Mac counts
  against its own `origin/main` as of its last fetch (`FETCH_HEAD`'s time), again at most every ten minutes, in the
  background.
- **Client** (`lib/turn-client.ts`): an entry point notes the sender for the card, and the runner takes it when the
  message goes to the CLI, so a message held for a slot, a restart or the turn's end keeps its sender. A message nobody
  noted is Weft's own (a queued skill, a resume, a Backlog card started); a card's first turn says who made it (a cron
  run, or another card by title, via `create_card`).
- **Time** (`lib/turn-env.ts` `clock`): the user's zone is the one their client last reported (`tz` on the hint: the
  browser's, or the Mac's for its own board and for rows it sends a worker); a Mac with none uses its own, since you sit
  at it; a worker with none says it doesn't know yet. The host's zone and both UTC offsets are always given.
- **Board column**: left out. During a turn it's always Running, so it would be noise.

### The client hint

`payload.client` on a `cloud_commands` row, `{ app: "desktop" | "web" | "phone", name?, tz?, via? }`
(`packages/weft-client/src/client-hint.ts`, read by `readClientHint`, which drops anything else and strips markup from
the name). weft.zip stamps it in `useWebBoard`'s `sendCommand`; this Mac's server stamps every row it sends a worker in
`lib/worker-board.ts` `insert` (desktop, the Mac's name and zone, `via: "relay"`), and a worker marks a session line's
verbs `via: "line"` (`lib/worker-kinds.ts` line). The phone app (`~/dev/weft-mobile`) doesn't stamp yet: an unstamped
row reads as "a remote board (weft.zip or the phone app; it didn't say which)". Locally, the messages and cards routes
say "the desktop board on this Mac" when the request carries the launch token (`elevated`), and "a local process" when
it doesn't (a thread's curl).

**It is a hint, never an authority.** Anyone holding the account's session can insert a row that says anything. Nothing
reads it for a check, a grant, a permission mode or a route; it only becomes words in the block. Which host runs a card,
who wrote a row and what it may do stay with `lib/host/dispatch.ts`, `remoteRefusal` and the approval rules
(mobile-security.md).

## Where the block goes, and where it doesn't

- **In**: `lib/runner.ts` `sendMessage` (after a puku session's own context, ahead of the task and break notes and the
  text) and `lib/runner-steer.ts` `steer` (a mid-turn message). Every backend reads the session's inbox, so Claude Code,
  puku, Codex and Goose all get it, on a Mac and on a worker alike.
- **Not ahead of a `/command`**: Claude Code, puku, Codex and Goose read a skill from the start of the text, so a
  message starting with `/` goes without it (its note is still taken, so it can't stick to a later message).
- **Not in the thread**: the thread item is the text you typed (`appendThread` gets `text`, not what the CLI got).
  `stripEnvBlock` (`lib/env-block.ts`) takes it out anyway where a message could come back: the transcript reader
  (`lib/transcript.ts` `EMBEDDED`) and the cloud rows (`lib/card-rows.ts` `projectItem`), so weft.zip and share links
  never show it. It sits on user turns only, so the BOARD STATUS and review parsers (assistant text) never see it; a test
  checks they ignore it anyway. The strip only matches the block's own shape (the tag alone on a line, a few plain
  lines, the closing tag), so a prose mention of the tag can't swallow text.
- **The explanation**: one line in the fixed thread instructions, `ENV_PROMPT` (`lib/env-block.ts`), in
  `weftSystemPrompt` for threads and the copilot (`lib/weft-prompts.ts`, a pinned prompt) and in Codex's per-turn
  instructions (`lib/codex-runner-prompt.ts`). It names the block "tagged weft-env" rather than writing the tag, for
  the strip's sake.

## Cost

Measured 2026-11-02 on an M1 mini: 250–290 bytes a turn (about 70–80 tokens), and about 45 µs to build (two cached
`Intl.DateTimeFormat`s; the git reads happen once, in the background). Nothing is added to the start-a-card path: no
spawn, no fetch and no file read on a turn.

## Tests

`lib/turn-env.test.ts`, `lib/turn-client.test.ts`, `lib/host-facts.test.ts`, `lib/runner-env.test.ts` (the block on
what the CLI gets, not in the thread), `packages/weft-client/src/client-hint.test.ts`, plus the stamps and notes in
`lib/host/dispatch.test.ts`, `lib/worker-kinds-line.test.ts`, `lib/worker-board-actions.test.ts`,
`components/web-board/WebReply.test.tsx`, `lib/worker-update.test.ts` and `lib/card-rows.test.ts`. The runner and
worker-board test fakes record what a test compares without the block or the stamp (`raw` and `calls` keep them).

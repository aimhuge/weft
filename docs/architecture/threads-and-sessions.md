# Threads and sessions

The runner is the heart of Weft. Each active card has a persistent CLI conversation. Claude Code and
puku-cli keep a process open through the Agent SDK's streaming `Inbox`; Codex starts one `codex exec`
process per turn and resumes its saved session id. The runner is split into small modules:

- `lib/runner.ts`: the public API the board and routes call (send, queue, ↑ edit, stop, retry, login, permission mode)
- `lib/runner-state.ts`: the `Session` and `Inbox` types, the shared maps on `globalThis`, the idle timer, and `hooks`
- `lib/runner-session.ts`: starting and driving a CLI, warm spares, the `BUILD` fingerprint
- `lib/runner-turn.ts`: what the CLI sends during a turn, through the result that ends it
- `lib/runner-ask.ts`: permission requests and answers
- `lib/codex-runner.ts`: Codex JSONL events, session resume, and the adapter into the shared turn handling

The turn loop runs from `sendMessage()` in `runner.ts` through the session and turn modules and back to
the turn queue (`sendQueued`, `needLogin`). The modules below `runner.ts` reach those through `hooks`
(in `runner-state.ts`), which `runner.ts` fills in as it loads, so none of them imports it back. Together they cover
the per-card session lifecycle, the permission and question flow, and the BOARD STATUS handling. Picking up existing Claude
Code sessions lives in `lib/import.ts` and `lib/transcript.ts` (see the end of this doc).

## Per-card session lifecycle

### `Inbox` and `query()`

`Inbox` (`lib/runner-state.ts`) is an `AsyncIterable<SDKUserMessage>` fed by `push()`. The
SDK's `query()` consumes it as the prompt, so a single CLI process keeps running
between turns and each user message is a new `SDKUserMessage` on the same iterator.
`close()` ends the input and lets the process exit.

### Codex CLI sessions

Codex is driven separately by `lib/codex-runner.ts`. A turn starts with `codex exec --json`; Weft reads
JSONL events for assistant text, command output, file changes and completion, and saves the `thread_id`
on the card. Later turns use `codex exec resume --json <thread_id> -`, so the conversation survives the
short-lived CLI process. The initial command receives the card folder, sandbox mode, model and reasoning
effort. The resume command supports a model override but no sandbox or reasoning-effort flags; Codex
keeps the original sandbox and effort for that saved session. Starting a fresh Codex session is required
to change either. Weft maps its
permission choices to Codex sandbox settings and uses Codex's own approval flow.

Codex threads do not receive Claude plugins or Weft's per-tool guards. The prompt asks the agent not to read
`.env` files; Codex's own sandbox and rules apply. Weft's MCP tools (browser, board, secrets, webhooks,
board_view) reach Codex over HTTP: each turn `driveCodex` opens a bridge (`lib/mcp-bridge.ts`), a random token held
in the registry and passed in the process's `WEFT_MCP_TOKEN` env var (never on the command line), and starts
Codex with `--config mcp_servers.<name>.url=http://127.0.0.1:$PORT/api/mcp/<name>`,
`bearer_token_env_var` and `default_tools_approval_mode="approve"` (`codex exec` has nobody to ask; tools
that need the user, like a vault fill, ask through Weft). `app/api/mcp/[server]` answers each request
statelessly with a fresh server from the same `weftMcpServers()` factory Claude and puku take in-process, and a
Codex `mcp_tool_call` item shows in the thread as `mcp__server__tool`. Codex reads `AGENTS.md` but not
`CLAUDE.md`, and neither it nor puku reads `.claude/skills` (puku: `.puku-cli/skills`, Codex: `.agents/skills`), so a new
session's first prompt carries the folder's `CLAUDE.md` (`codexProjectInstructions`) and an index of its
skills, and a message that is just `/name args` is sent as that skill's instructions (`skillInvocation`).
`/weft:<skill>` text is expanded the same way from the local skill file for that turn. The shared turn
handler still records assistant messages, command output, `BOARD STATUS`, changed files and turn completion.

### The CLI process and its children

`spawnClaudeCodeProcess` (`spawnCli` in `lib/cli-process.ts`) replaces the SDK's own spawn so each CLI
starts `detached`, the leader of a process group of its own. puku-cli is a `node` wrapper that starts a
`Puku` child and doesn't pass signals on, so killing only the wrapper (all the SDK does) used to leave `Puku`
under PID 1 burning CPU. Now the whole group ends: on the SDK's `kill()`, on its abort (after its stdin-EOF
grace), and when the wrapper exits on its own (an idle close): SIGTERM, then SIGKILL after `KILL_GRACE_MS`.
Live groups sit in `groups`, and a `process.on("exit")` hook SIGKILLs them all when the server exits (Next's
SIGTERM/SIGINT handlers call `process.exit`). Because a custom spawn skips the SDK's stderr capture, `spawnCli`
keeps the stderr tail itself and `failed()` adds it back to the error (`withStderr`), so a logged-out or
rate-limited CLI still reads as one.

A server killed outright never runs that hook, so `prewarm()` calls `reapStrayClis()` (`lib/cli-reaper.ts`):
it kills processes whose parent is PID 1, that are `Puku`, a `puku-cli` wrapper or the SDK's Claude Code
binary from Weft's `node_modules`, and whose cwd (from `lsof`) is in a project or card folder. A puku you run
in a terminal has the shell as its parent, so it never matches.

### Bash commands and orphaned test workers

Claude Code runs every Bash command in a process group of its own (the command's `zsh` is its group's
leader), so signalling the CLI's group never reached a `pnpm test` it had running. Vitest's forks pool makes
it worse: tinypool's workers never watch their parent. An idle worker exits once the IPC channel closes, but one
mid-test keeps running under PID 1, and a test with a live timer keeps it running for good. On 2026-10-17 twelve
`node (vitest N)` workers, 24-56 minutes old, hung the Mac. Reproduced by killing a run's `node (vitest)`
with SIGKILL or SIGTERM mid-test: every busy worker reparented to PID 1 and kept its CPU. Four layers now stop it:

- **Workers end themselves.** `test/orphan-guard-setup.ts` (vitest `setupFiles`) calls `guardOrphan()`
  (`lib/orphan-guard.ts`): a worker SIGKILLs itself on the IPC `disconnect`, or when a 2 s check sees its ppid
  change. SIGKILL, because vitest swaps `process.exit` out during a test. In the same repro every worker was
  gone within 4 s.
- **Stopping a card takes its Bash commands with it.** `endGroup()` first lists the groups below the CLI's
  (`lib/process-tree.ts`, one `ps -axo pid=,ppid=,pgid=`), while the CLI is still alive to link them, and
  sends them the same SIGTERM, then SIGKILL after the grace. `killAllGroups()` does the same on server exit.
- **Whole-suite runs take turns.** `pnpm test` and `pnpm coverage` go through `scripts/run-tests.mjs`: a run
  with no file filter waits for the machine-wide `test` lock (`runHolding()` in `scripts/one-at-a-time.mjs`,
  which also passes a SIGINT/SIGTERM/SIGHUP on to the command it holds the lock for). A run of named files
  goes straight through.
- **Backstop.** `startWorkerReaper()` (`lib/worker-reaper.ts`, started from `prewarm()`) reaps every 5 min
  any `node (vitest N)` whose parent is PID 1, at least 2 min old, with its cwd in a project or card folder.
  That catches a worker stuck in a synchronous loop, which can't reach its own check. A run whose
  `node (vitest)` is alive keeps its workers' parent, so another card's tests are never touched. The
  same sweep matches orphaned `next dev` servers — `next-server (vN.M)` or `node …/next/dist/bin/next dev …`
  whose launcher died and whose `next-server` reparented to PID 1, holding ~1.9 GB of heap. Without this, a
  crashed Weft leaves an orphaned dev server that contributes directly to the next heap-OOM SIGABRT. A user
  `next dev` has a shell as its parent, so it's never matched.

### Idle puku CLIs (`lib/puku-idle.ts`)

An idle puku-cli used 8-15% CPU (more with a big session) while Claude Code idled at 0.4%. A CPU profile over
the inspector (`kill -USR1`, then CDP `Profiler`) showed a timer calling `gc` and ~4% of samples in the garbage
collector: puku-cli's headless loop runs `setInterval(Bun.gc ?? globalThis.gc, 1000)`, a line from Claude Code,
where Bun's `gc()` is a cheap hint. puku-cli runs on Node and its bin relaunches itself with `--expose-gc` (and an
8 GB heap), so on Node it's a full synchronous collection every second. `backendEnv()` adds
`PUKU_CLI_DISABLE_HEAP_RELAUNCH=1` to a puku thread's env: no relaunch, no `gc`, no timer, idle at 0.1%, and one
process instead of wrapper plus `Puku`. The price is Node's default heap limit (~4 GB on a 16 GB Mac).

Puku is also capped tighter than Claude Code: `trimIdle()` closes idle puku sessions past `MAX_IDLE_PUKU` (2),
`keepAliveFor()` closes one after `PUKU_KEEP_ALIVE_MINUTES` (10) even when keep-alive is never, `ensureSpare()`
keeps one puku spare (the folder asked for last), and `adoptSpare()` refills only Claude Code spares
(`refillsSpare()`). A puku card with no spare starts cold, about 1.1-1.6 s to answer `initialize`.

`open()` starts a session, registers it in the `sessions` map (kept on `globalThis`, so
every API route shares it), and returns the running `Session`. `drive()` (`lib/runner-session.ts`) calls `query()` with:

- `cwd`: the card's folder
- `resume`: the existing `sessionId` (or unset for new cards)
- `forkSession`: true when Weft continues a session that's open elsewhere
- `permissionMode`: `default` / `acceptEdits` / `auto` / `bypassPermissions` (`MODES` in `lib/types.ts`)
- `systemPrompt.preset: "claude_code"` appending `weftSystemPrompt(spec)` (`lib/weft-prompts.ts`, the one
  place that lists what Weft injects): `WEFT_SOUL_PROMPT` + `BROWSER_PROMPT`, then either `COPILOT_PROMPT`
  (the copilot) or the secrets, webhooks, restart, subagent, `threadPrompt()` and review prompts (board threads).
  The content of every string in `WEFT_PINNED_PROMPTS`, plus the thread prompt and subagent model, is part of
  `currentBuild()`, so editing any of them replaces idle sessions (busy ones finish first); the text is
  memoized per that key
- `mcpServers`: copilot gets `browser` and `board`; board threads get just `browser`
- `plugins`: board threads load `plugin/` (`PLUGIN_DIR` in `lib/skills.ts`), Weft's own skills,
  so `/weft:done` and `/weft:commit` work in every thread. The packaged app ships the folder in
  `Resources/plugin` and passes `WEFT_PLUGIN_DIR` (`electron/server.cjs`)
- `canUseTool`: trusted tools auto-allow (`isTrustedTool`); everything else is routed to
  `askUser` so the card can prompt the user
- `pathToClaudeCodeExecutable`: `pukuPath` (looked up via `/usr/bin/which puku-cli`)
  for the puku backend, `undefined` for Claude Code
- `allowDangerouslySkipPermissions`: `true` for non-copilot Claude Code cards
  (so a card can switch to `bypassPermissions` later, including a spare it takes
  over); omitted for the puku backend because puku-cli's CLI rejects the flag,
  and omitted for the copilot card

### Resume after a restart

A CLI process doesn't outlive the app, so `loadState()` (`lib/store.ts`) moves a card that was `running` or had a
`pending` permission to Review as "Stopped when the app closed" and sets `interrupted`. On the first board load,
`prewarm()` (`lib/copilot.ts`) calls `resumeInterrupted()` (`lib/resume.ts`), which sends each such card's session
`RESUME_TEXT` with `sendMessage()` and sets `resumed`. The next `sendMessage()` clears both flags. A card that is still
`resumed` when the app closes again isn't marked, so a turn that keeps getting cut off is resumed once, not on every
launch. Cards with no `sessionId`, archived cards and the copilot aren't resumed; a send that throws (folder gone)
leaves the card in Review with the reason in `error`.

### A session the CLI no longer has

A card names its conversation as soon as the first message goes out (`keepSessionId`, `adoptSpare` in `lib/runner-session.ts`), before
the CLI has written any of it, so a CLI killed in that gap (a restart, a Stop) leaves a `sessionId` with no transcript. The next
resume answers `No conversation found with session ID`, as an error result and again as the SDK's exit error, and the error
result names the same missing id, so the card would fail every message. `lib/lost-session.ts` catches it in `recoverFrom`
(`lib/runner-turn.ts`) and in `failed` (`lib/runner-session.ts`): the first report, while the card still names the lost id,
clears `sessionId` and re-sends the last message through `sendFresh` (`lib/splice.ts`, `echo: false`) from a brief, with a
`spliced` row in the thread; the second finds the id already gone and does nothing.

### Warm sessions and keep-alive

`scheduleIdle()` (`lib/runner-state.ts`) starts a timer for `keepAliveMinutes()` minutes
after the last message. Setting `keepAliveMinutes` to `0` (the default) means the
session stays open until the app quits. Picked-up Claude Code sessions cap at 10 idle
minutes so Weft doesn't hold a session the Claude app might reopen.

`warmUp(cardId)` (`lib/runner-session.ts`) opens the CLI without sending anything. It's a
no-op for picked-up cards and for cards whose `cwd` no longer exists.

`isStale()` marks a session stale when its `ended` flag is set, or when it is idle and its
`BUILD` fingerprint no longer matches (see below). `currentSession()` closes and replaces a
stale session on next use, and `closeWhenIdle()` (`lib/runner-state.ts`) closes one after the keep-alive time.

### Spare CLIs per project

`ensureSpare(cwd, backend)` (`lib/runner-session.ts`) keeps up to `MAX_SPARES` (3) idle
CLI processes keyed by `backend|cwd`. `adoptSpare()` (`lib/runner-session.ts`) hands a
spare to a new card, switches it to the card's permission mode, model and effort
(`switchSpare()` in `lib/spare-switch.ts`), marks the card `warm: true`, and immediately
starts a fresh spare for that folder.

### Switching a card's CLI

A card's CLI is set at creation, but three affordances let you change it after the fact:

- **The thread header's `BackendPicker`** (`components/BackendPicker.tsx`) wraps the model chip
  in a button. Its menu lists each CLI's models (`MODELS` in `lib/new-thread.ts`). A model of the
  card's own CLI changes the open CLI's model in place (`setModel()` in `lib/runner.ts`, which goes
  through `switchSpare` so commits are signed as the new model), even mid-turn. A model of the other
  CLI switches CLI; that row is disabled while a turn is live (`lib/format.ts:isLive`). The copilot
  (`role: "copilot"`) is locked to Claude Code, so it keeps the static `BackendBadge`. The picker
  calls `api.switchBackend(id, backend, false, model)`; the route refuses a model the CLI doesn't
  serve. No replay: that's the rate-limit banner's job (it always replays).
- **Right-click → "Run on puku-cli" / "Run on Claude Code"** in `lib/card-menu.ts`. The bulk
  equivalent is the **"Switch all"** link at the top of a column (`components/switch-all-button.tsx`),
  which only reaches cards in the *Running* column.
- **The rate-limit banner** on a card that hit a plan limit (`CardView.RateLimitSwitch`): a one-click
  "Run on puku-cli" / "Run on Claude Code" button that flips the backend *and* replays the last
  user message.

All three paths land in `switchBackend()` (`lib/backend-switch.ts`), which ends the session, clears
`sessionId` and `rateLimitHit`, normalizes the per-CLI incompatibilities (puku has no YOLO, no
`xhigh` effort, no Claude models) through `effortFor()` and `modelOn()` (`lib/new-thread.ts`), and
optionally replays. `modelOn` matters because the Puku gateway doesn't refuse a Claude id: it
answers it as puku-ai-2.8, so a switched card's chip used to say "Fable 5.1" on puku. The next
turn's CLI flags are then derived from `specFor(card)` (`lib/runner-state.ts`), which also
normalizes through `effortFor` and `modelOn` (and so does the chip, through `runningOn`) — so a card already in a bad state recovers without the user
flipping it. See `docs/bug-fixes/012-fable-xhigh-effort-crashes-puku.md`.

A card whose **very first turn** came back with an error gets a different escape
(`components/FirstMessageErrorBanner.tsx`): rerun the first message on the user's configured
backup model (Settings → Models → Backup model, `components/BackupModelPicker.tsx`), or delete
the card. The predicate is `firstMessageFailed(card, items)` (`lib/first-message-failed.ts`):
exactly one user message, no assistant text after it, the card isn't live, and `card.error` is
set. The handler is `rerunOnModel(cardId, model)` next to `switchBackend`: it ends the session,
sets the new model (and clears `sessionId` and `error`/`rateLimitHit` either way), then
`sendMessage`s the last user message with `echo: false`. The route is
`POST /api/cards/:id/rerun-model` (any model any installed CLI serves); the
web board's read-only transport leaves the banner's `onOpenSettings` undefined, so its thread
shows no banner at all.

### Commit and PR attribution

A board thread signs its commits "Co-Authored-By: <model> on Weft" and its PRs "Generated with
Claude Code on Weft". `signAsWeft()` (`lib/attribution.ts`) passes the CLI's `attribution` setting
through `query.applyFlagSettings`, which replaces Claude Code's default lines, once the model is known:
at the session's `init` message (the card's model, else the one the CLI reports) and again when a spare
takes a card with a different model. `modelName()` turns an id like `claude-opus-5-5[1m]` into
"Claude Opus 5.5"; an alias or a puku model reads "Claude". The copilot doesn't commit and puku-cli has
its own attribution, so neither is signed.

Spares open in the default permission mode (`defaultPermissionMode()` in `lib/settings.ts`, Auto unless
changed in Settings), the same mode `POST /api/cards`, the New thread dialog and the copilot's `create_card`
start a card in, so adopting one rarely needs a mode switch. The dialog's effort starts at High and then
follows the last card's (`weft.effort` in localStorage).

`prewarm()` (`lib/copilot.ts`) runs once per server start: it starts the Claude Code
session sync, ensures the copilot card and warms it, and starts a spare in the most recent
project (or the folder of the first non-copilot card).

### BUILD fingerprint

`BUILD` (`lib/runner-session.ts`) is a SHA-1 of the source of `drive`, `queryOptions`, every turn
handler (`TURN_CODE` in `runner-turn.ts`), `askUser`, `settle` and the pure rules in `lib/turn.ts`, joined with
newlines. Each API route can load its own copy of
the runner modules, so the fingerprint has to come from the code, not a random value at load
time. Idle sessions whose `build` doesn't match are replaced on next use (`currentSession()`,
`warmUp()`, `ensureSpare()`), which is how dev-mode code reloads swap out stale CLIs. A busy
session is never replaced mid-turn.

### Queued messages (automations)

`queueMessages(cardId, texts)` (`lib/runner.ts`) runs each text as its own turn, in order. It
sends the first right away when the card is idle; the `result` handler sends the next once the
turn ends, unless the turn was stopped or failed (the queue is dropped) or ended in `needs_you`
(the queue waits for the turn after your reply). A CLI that dies mid-turn drops it too. A wrap-up
is the one exception to the `needs_you` hold: a wrap-up is over whether it asks for something or
not, so the messages queued behind it still go out (see "Archiving after Done").

Board automations use it: `messagesForMove()` (`lib/automations.ts`) returns `/<skill>` messages
for your own moves to Review or Done, which `PATCH /api/cards/[id]` queues. "A thread starts"
rules don't queue anything; `firstMessage()` appends "Start by using the /x skill" to the card's
prompt, used by every path that starts a Backlog card (`POST /api/cards`, the PATCH to running,
the copilot's `start_card`). The copilot's `move_card` never runs automations.

#### /weft:done's model and effort override

Settings → **Automations → Done wrap-up** has a "Run /weft:done on …" row (`components/DonePicker.tsx`)
with two side-by-side selects: a model and an effort, each starting at "Card's own" (id `""`).
Handy for keeping the wrap-up on a fixed model or cost ceiling without changing the thread's
own picks. Both `doneModel` and `doneEffort` live in `lib/settings.ts` (`doneModel()` /
`setDoneModel()`, `doneEffort()` / `setDoneEffort()`) and ride on `SettingsView`; the empty
string is the default and is stored as `undefined` in `settings.json`. The model menu is
`components/ModelSelect.tsx` (Claude and Puku headings, the same one `SubagentPicker` uses),
and the effort menu is `EFFORTS` from `lib/new-thread.ts`. `app/api/settings/route.ts`
validates each value against the model/effort catalogs and 400s on a bad id.

The override is turn-scoped. When you move a card to Done, `moveCard` in
`app/api/cards/[id]/route.ts` calls `applyDoneOverride(card)` (right before queuing the
move's `/weft:done` message): if `doneOverrides(card)` (`lib/automations.ts`) returns a
non-empty patch, the card's `model` / `effort` are saved to `preDoneModel` / `preDoneEffort`
and replaced with the override. The next turn (the queued `/weft:done`) starts on the
override; `lib/runner.ts` `restoreDoneOverride(cardId)` then puts the originals back.
`finishResult` in `lib/runner-turn.ts` calls it once the `/weft:done` turn settles — success,
failure, or stop — so the next turn on the card sees its real picks, and a card that never
moved to Done (a `/weft:done` you typed yourself) is a no-op for the restore.

`doneOverrides` is selective rather than blanket: the model applies only when the override's
backend matches the card's backend (a Claude id on a puku card or a puku id on a Claude card
is dropped, since switching CLIs would start a fresh session and break `/weft:done`'s
view of the conversation). The effort always applies, but `effortFor()` steps xhigh down to
high for puku (puku-cli rejects `xhigh`). The result is that a puku card with both fields
set still gets a real override, just the one its CLI accepts.

### Editing your last message (↑)

Each prompt a Claude board thread sends carries a uuid (`randomUUID()` in `sendMessage()`), kept on
its thread item as `id` and passed to the CLI as the `SDKUserMessage`'s `uuid`, so the session
transcript in `~/.claude/projects` records the prompt under it. ↑ in an empty reply box with nothing
queued pulls the last message back (`lastSent()`, `lib/edit-last.ts`; `useEditLast()` in
`lib/use-edit-last.ts` wires it into `ThreadView`), and Enter posts it to
`POST /api/cards/[id]/messages` with `edit: true`.

`editLastMessage()` (`lib/runner.ts`) closes the card's CLI (which ends a running turn and flushes
its transcript), drops anything queued behind it, then looks the prompt up in the transcript
(`sessionRewindPoint()`, `lib/rewind.ts`). The prompt's `parentUuid` is the last entry of the turn
before it, so the card reopens with `resume` plus `resumeSessionAt` set to it, which drops that
prompt and everything after it from the conversation; a prompt with no parent opened the session, so
the edit starts a fresh one. `foldThread()` (`lib/store.ts`) folds the old message and its turn into
one `{ kind: "edited" }` item (the board truncates its copy on the `truncate` flag of the thread
event), and the new text goes out through `sendUserMessage()`. Files the dropped turn changed stay
as they are; the reply box says how many edits stay.

When the transcript doesn't hold the prompt (a picked-up session, a puku thread, a message from
before prompts were tagged, or a slash command the CLI expands), nothing is folded and the edit goes
out as a new message after the old one; the reply box says so before you send. Rewinding writes to
the session, so one that's open in another app is continued as a copy (`forkSession`), as a
normal send does. An edited send can't use a warm spare, so it starts a cold CLI.

### Continue (▶ Continue, ⌘⇧↵)

The reply box offers Continue only when the last turn stopped short (`turnCutOff` in `lib/reply-mode.ts`: a
stop, an error, a plan limit or the app closing): as the primary button of an empty box, and as "Continue here"
in the send menu once you've typed. It sends the literal word `continue` through the same `onSend` path a
typed message uses — the same call the card-level ▶ makes (`lib/resume-actions.ts`,
`api.send(id, "continue")`), which is the same shape every other message takes. On the desktop,
⌘⇧↵ (or `mod+shift+Enter`) does the same from the keyboard (`lib/use-reply-continue.ts`, registered in the
**Thread** group). The weft.zip web board's reply box gets the same button (no ⌘⇧↵ — the web has no
global keymap); it's hidden on a card a teammate's Mac runs (`canReply(cardRow, userId)` in
`lib/web-commands.ts`). The button and the shortcut share the same canContinue rule and both
grey out under the same conditions: a turn running (Send queues), a question waiting (Send answers),
the box a `!` shell command (Send runs it), or ↑ editing the last message (Send replaces it).

### Scheduled messages (send later)

The reply box's clock button (`components/SendLater.tsx`, Alt+Enter) saves a message on the card
as `card.scheduled` (`ScheduledMessage[]`, soonest first) through `POST /api/cards/[id]/scheduled`;
`DELETE` takes one back. The server sends them, not the browser: `startScheduler()`
(`lib/scheduler.ts`, started from `prewarm()`) checks every 15 s and calls `sendUserMessage()` for
each card's first due message, so it goes out with the thread closed, and one that came due while
Weft was shut goes on the first check after the next start. A card mid-turn keeps its message until
the turn ends. A failed send puts the reason in `card.error` and is not retried.

The default time is the plan's next 5-hour reset plus a minute (`RESET_GRACE_MS`), read by
`nextFiveHourReset()` (`lib/schedule.ts`) from the latest `stats.fiveHour.resetsAt` any Claude card
has seen (the figure the status bar shows). `nextWeeklyReset()` reads `stats.sevenDay` the same
way, with the highest share used any card saw at that reset; `planResets()` gathers both for the
reply box. When the weekly window is at `WEEKLY_NEAR` (90%) or more, `sendLaterOptions()` adds "At
the weekly reset" (also plus `RESET_GRACE_MS`) after the 5-hour one; at 100% the weekly limit is
what stops the thread, so it goes first and becomes the Alt+Enter default. Puku threads, and Claude
ones with no known reset, get "In 1 hour" first; "Tomorrow morning" (9am) and a date-time picker are always there. The copilot
can't schedule. The card shows the next time as a clock badge in its footer.

A message that reaches a busy Codex or Goose thread, or a `/command` for any thread, is held the same way
instead of refused ("This thread is already running"; plain text for Claude Code and puku goes in mid-turn, below):
`sendUserMessage()` calls `holdForTurn()` (`lib/runner.ts`), which adds it to
`card.scheduled` with `afterTurn: true` (the page links' Tell me what to change, a failed commit's
note, the scheduler). `finishResult()` (`lib/runner-turn.ts`) calls `sendHeld()` through `hooks` once
the turn is over and no queued automations remain, even when the turn ends needing you (the held text
may be the answer); everything held goes out as one message. The reply queue and the card footer
label it "after this turn" (`sendsWhen()`, `lib/schedule.ts`); it can be taken back or cancelled
like a scheduled one. The copilot has no queue, so it still refuses a message mid-turn. A Done move
from a page's Commit button (`moveToDone()`, `lib/pile-commit.ts`) on a busy card leaves the card
where it is and queues the Done automations, which run after the turn.

### Mid-turn messages

The Claude Code CLI folds a message you send during a turn into that turn: it waits in the CLI's command queue
and goes to the model as the next tool call returns, so you can steer a long turn without stopping it. Weft does
the same for Claude Code and puku threads. `holdForTurn()` hands plain text for a busy session to `steer()`
(`lib/runner-steer.ts`), which pushes it into the session's live `Inbox` with a uuid of its own (kept in
`session.steered`) and puts it in the thread at once, marked `midTurn` ("Sent mid-turn · read after the next tool
call"). It gets no prompt id, so ↑ sends an edit of it as a copy: there's no turn of its own to rewind. The reply
box's primary while such a turn runs is **Send** with the chip "After the next tool call" (`lib/reply-mode.ts`
mode `steer`); **Queue · after this turn** and **Send now** are in its ▾.

A turn can end without another tool call to fold the message in after. The CLI then runs it as a turn of its
own, straight after the result, without Weft sending anything. The result's `user_message_uuids` lists the
messages a turn took in, so `waitingInCli()` knows which steered ones are still waiting; when any are,
`handleResult()` (`lib/runner-turn.ts`) settles the turn's cost and stats but keeps the card running and the
session busy (`goOn()`), and nothing held or queued goes out until that follow-on turn's result. puku's results
don't list `user_message_uuids`, so its steered messages count as taken in, and a follow-on turn is picked up
by `handleAssistant()` as its first reply arrives, as a background task's is. `queued_turn_count` on the
result is no help here: it read 0 with a steered message waiting.

A Stop doesn't drop a steered message the CLI still holds: the interrupt leaves its queue alone, so the message
runs as the next turn. Codex and Goose run one CLI process per turn, and the copilot has no queue, so they keep
the hold above.

### Archiving after Done

Moving a card to Done also calls `archiveWhenIdle()` (`lib/runner.ts`): with no queued or running
turn it sets `card.archived` at once; otherwise the id goes in `archiveAfter`, the card gets
`wrappingUp: true`, and the `result` handler archives it (`column: "done", archived: true`,
`wrappingUp: false`) once the queue drains. Typing `/done` does the same through `sendUserMessage()`.
While `wrappingUp` the card stays `column: "running"` (spinner, ■ Stop, the Running count and restart
recovery all key on it) but `shownColumn()` in `lib/board-view.ts` files it under Done. A stopped or
errored turn drops the id and clears the flag, so the card lands in Review unarchived; a starred card
is never archived; a restart clears the flag (`loadState` in `lib/store.ts`). `sendMessage()` clears
`archived`, and a move to any other column does too. The board hides archived cards until "Show N archived"
in the Done header (`components/Board.tsx`). Archived cards don't count toward the header's
"need you" and "running" totals or a project chip's dots (`summarizeProjects` in `lib/board-view.ts`),
so a hidden card never shows a count you can't find.

A wrap-up that ends with `column=needs_you` is still a finished wrap-up: the work is done, so the
card goes to Done and is archived rather than parked in Needs you waiting for a reply nobody asked
for. "This turn is a wrap-up" is the turn's own marker: `sendMessage()` in `lib/runner.ts` sets
`session.wrapUp` when the message that starts the turn is a done command (`/done`, `/weft:done`), so
`columnAfterTurn()` in `lib/turn.ts` takes it as a fourth argument and reads a `needs_you` status as
`done` for a wrapping turn. The card never lands in Needs you at the end of a wrap-up:
`handleResult()` in `lib/runner-turn.ts` stores `done`, and `settleWrapUp()` there no longer holds a
wrap-up back for a `needs_you` status, so it settles and archives like any other finished wrap-up.
The automations queued behind it still go out too: `finishResult()` keeps the queue waiting on a
`needs_you` turn only when that turn was *not* a wrap-up, since a wrap-up is over whether it asks
for something or not.

The marker is per turn, not per card, and that matters: a Done move landing on a busy card marks
the *card* as wrapping up (`archiveAfter`, `lib/runner.ts`), but the turn already running is an
ordinary one, and it still ends where its status line says — a turn that asks for something waits in
Needs you like any other. A plain turn that ends needing you is unchanged: it waits in Needs you and
the queue behind it waits for your reply. A wrap-up that ends in `review` still stays on the board,
unarchived, with what it couldn't do in `remaining`.

## Permissions and questions

### Changing a card's mode

`PATCH /api/cards/:id` with `{ permissionMode }` validates it against `MODES` and calls
`setPermissionMode(cardId, mode)` (`lib/runner.ts`), which saves it on the card and, when the card
has an open CLI, calls `query.setPermissionMode(mode)` the way `adoptSpare()` does, so it applies
mid-turn. `bypassPermissions` is refused for the copilot and puku cards, whose CLIs start without
`allowDangerouslySkipPermissions`. The thread header has a small `ModePicker`
(`components/ModePicker.tsx`, the same select the new-thread dialog uses) and the card's
right-click menu lists the modes with the current one ticked (`mode:<id>` in `lib/card-menu.ts`).
A request already waiting on the card still needs an answer after a switch.

### `canUseTool` -> `askUser` -> `settle`

When the SDK asks to use a tool, `canUseTool` either auto-allows (browser tools, and
the copilot's read-only board tools) or hands the request to `askUser()`
(`lib/runner-ask.ts`). `askUser` records a `permission` thread item, pushes a
`Pending` onto `session.pending`, and returns a `Promise<PermissionResult>` that
resolves only when the user answers.

`answerPermission(cardId, allow, answers, pendingId)` (`lib/runner-ask.ts`, re-exported by `lib/runner.ts`) is the API
surface. `pendingId` ties the answer to the specific request the user saw; without it
the oldest pending request is answered. The user picks `allow`/`deny` (or fills in
`answers` when it's a question); `settle()` (`lib/runner-ask.ts`) replaces the
permission thread item with the decision, moves the card back to `running` if no more
requests are queued, and resolves the SDK's `Promise<PermissionResult>` with
`{ behavior: "allow", updatedInput }` (and the answers) or `{ behavior: "deny" }`.

A card waiting on you (a question or an Allow/Deny prompt) can be dragged to Backlog, Review or
Done to triage the thread out of "Needs you" without answering it: `fixed = card.column ===
"running" || copilot` in `components/CardView.tsx`, so any card that's not running and isn't the
copilot is draggable, and the Allow/Deny row is gated on `card.pending`, so it stays offered
wherever the card parks. On the server, `moveCard(card, column)` in `app/api/cards/[id]/route.ts`
permits the move when `card.pending && MANUAL.includes(column)`; the original question stays open
and answering it later (in Backlog/Review/Done) runs the turn on.

### `AskUserQuestion` -> `QuestionForm`

`readQuestions()` (`lib/turn.ts`) sanitizes the SDK's `questions` array
(question, header, multiSelect, options with label/description). The card shows them
through `QuestionForm.tsx`. The user answers with one label (or several for
`multiSelect`) plus a free-text "other" per question, or skips. Answers become
`Record<question, "label, label">` and are passed as `updatedInput.answers` to the
SDK on allow.

The panel (`ThreadView.tsx`) is capped at 60% of the window height, and the form
scrolls only its questions: Send answer and Skip stay pinned below them, so a long
list never pushes them off screen.

## BOARD STATUS protocol

The thread prompt (in `lib/settings.ts`, editable as "Thread instructions") tells
each agent to end every reply with:

```
BOARD STATUS: column=<needs_you|review|done> | stage=<...> | remaining=<...>
```

`lib/status.ts` (`extractStatus`) finds the line, even when wrapped in backticks or
emphasis and in any letter case. The column is normalized to snake_case and must be
`needs_you`, `review`, or `done` (anything else is ignored), `remaining=none` becomes
`undefined`, and the line is stripped from the text shown on the card. `handle()` in
`lib/runner-turn.ts` updates the card's stage and remaining from each assistant message as the
turn progresses, and applies `column` on the `result` message: the status line in the final
result wins, with the last one seen during the turn as a fallback. A stopped or failed turn
always lands in `review`. A wrap-up is the one exception: a `needs_you` status on a turn that *is* the
wrap-up reads as `done`, because a finished wrap-up is archived into Done whatever it asks for
("Archiving after Done"). `lastLine` is the first non-empty line of the assistant's text or
result summary.

## Auto-login

When a turn ends or `drive()` throws with text matching `isNotLoggedInError`
(not-logged-in, invalid API key, oauth expired, authentication_error), `needLogin()`
(`lib/runner.ts`) moves the card to `needs_you`, adds the card id to
`loginWaiters[backend]`, and calls `startLogin(backend, onDone)`.

`lib/login.ts` runs `<cli> auth login` in the background, strips ANSI/OSC8, finds the
login URL (an OSC8 hyperlink target, falling back to a plain `https://` URL), and publishes
a `login` view to the board (the `LoginDialog`). When the process exits it checks
`<cli> auth status --json` once: logged in means done. If the CLI demanded a real TTY,
`openLoginInTerminal()` runs an AppleScript that opens Terminal with the login command, then
polls `auth status` every 3 seconds (up to 10 minutes) until it reports `loggedIn: true`. On success, `retryAfterLogin(backend)` resets
`loginWaiters` and replays the last user message on each waiting card via `retry()`
(`lib/runner.ts`), which calls `endSession` then `sendMessage` with `echo: false`.

## The copilot

`lib/copilot.ts` creates a card with `id: COPILOT_ID` ("copilot"), `role: "copilot"`,
`cwd: os.homedir()`, `backend: "claude"`, and `model: copilotInitialModel()` — the pick from
Settings → Models → Copilot, or the user's last-picked Claude model when that's the default
(`lib/new-thread.ts` `modelFor`). The card is filtered out of the board
(`listCards().filter((c) => c.role !== "copilot")` in the cards route) but its thread
still runs through `runner.ts`. `resetCopilot()` ends its session, clears its
thread, and re-warms it. The model is set once when the card is first made; changing the
pick takes effect on the next "New chat" in the copilot lane.

The copilot opens two ways:

- As a card, in the same framed window as any thread. It shows at the top of whichever column it is in
  (`components/Board.tsx`, drawn by `CardView`), and `toggleCopilot()` opens or closes it: a click on its card, the
  top bar's ✨ Copilot button (lit while it's the open card), the `c` key and the command palette all call it. It
  selects `COPILOT_ID` (through `openCard`, which warms the CLI) and `selected` falls back to the `useCopilotCard()`
  card, since the cards route leaves it out of `cards`. `components/ThreadPanel.tsx` has a `pilot` mode: ✨ "whole
  board" in place of the folder, `NewChatButton` (`onNewChat` → `api.resetCopilot()`) in place of skills, star, archive
  and delete, no rename, no "+ tag", no Send later or review panel, and `CopilotEmpty`
  (`components/CopilotEmpty.tsx`, shared with the window) as the empty thread. The card isn't draggable
  (`fixed = card.column === "running" || copilot` in `CardView.tsx`) and can't be starred, archived, deleted or
  filed under a project; the server rejects moving, archiving and deleting it. The board's `browser.prune` includes `COPILOT_ID` alongside the
  live cards, so its pane page survives like a card's.
- In its own `BrowserWindow` (`COPILOT_SHORTCUT` `Control+Alt+Space`, ⌘J in the app menu, the `weft://copilot` link, the
  tray and dock items), which works with the board hidden. The window is hidden on close so the conversation
  survives; `useDesktopBridge()` still reports its open state as `copilotOpen`, which the board no longer draws.

`lib/board-tools.ts` registers the `mcp__board__*` MCP server used only by the
copilot: `list_cards`, `read_thread`, `create_card`, `move_card`, `stop_card` are in
`SAFE_BOARD_TOOLS` and auto-allow through `isTrustedTool()`. `start_card`,
`send_message`, and `answer_permission` are NOT in the set, so they reach the user
through `canUseTool` -> `askUser`; `describeBoardTool()` makes the prompt readable
("Start "Weft desktop app"", "Reply to "…": …", "Allow Bash on "…""). The
`start`, `stop`, `answer`, `isBusy` actions are passed in as `BoardActions` to
`boardMcpServer()` to avoid a circular import.

The copilot's CLI also gets `browserMcpServer()`, so it shares the same `mcp__browser__*`
tools as every other thread.

## Picking up existing Claude Code sessions

`lib/import.ts` reads `~/.claude/projects/<project>/*.jsonl` and the SDK's
`listSessions({ includeProgrammatic: false, limit: 10_000 })`. Once per server start
and every `SYNC_EVERY_MS` (60s) it calls `runSync()`:

- For each session: skip if the id is in `dismissedSessions()` (from
  `lib/settings.ts`) or if `session.cwd` is under a temp dir
  (`os.tmpdir()`, `/tmp/`, `/private/tmp/`, `/private/var/folders/`).
- `lastActivity(file)` reads the last 256KB of the `.jsonl` and finds the last
  `"timestamp":` field; cached by `mtimeMs` because file times are unreliable.
- `parseTitle()` maps a "STAGE - title" custom title through `STAGES`
  (Planning, Pre-build refactoring, First shot, Going deeper, Polishing, Post-build
  refactoring, Cleaning up, Done). `columnFor()`: `Done` stage -> `done`, any other
  stage -> `review`, otherwise: `Date.now() - lastActivity < 3 days` -> `review`,
  else `done`.
- New sessions become cards with `source: "claude-code"`, in the permission mode the session last
  ran in (`sessionMode()`): the last `"permissionMode"` in the file's tail (user messages and
  `permission-mode` records carry it), else in its first 256KB, else `permissions.defaultMode` from
  `~/.claude/settings.json`, else `default`. `toPermissionMode()` (`lib/types.ts`) maps modes Weft
  doesn't run (`plan`, `dontAsk`) to `default`. Cards picked up before this keep their mode; change
  it from the thread header or card menu. For existing picked-up cards, a
  newer last message or a new title from outside Weft updates the card (and moves it) unless
  Weft has that thread open (`warm`); cards Weft created, and cards that continued a session
  as a copy (`forkedFrom`), are left alone.
- `openElsewhere` comes from `openSessions()`: `/bin/ps` parsed for
  `--resume=<uuid>` / `--session-id=<uuid>`, plus Claude Code's own list of running sessions in
  `~/.claude/sessions/<pid>.json` (the only place a session the Claude app started fresh shows
  up). Entries whose pid isn't running, and Weft's own children, are ignored.
- Live sessions move on their own. That list reports each session as `busy`, `idle`, or
  `waiting`; `liveColumn()` puts busy ones in Running and waiting ones (a question or permission
  prompt in the other app) in Needs you, with a status line saying so. Without a report, an
  unfinished turn at the end of the session file (`midTurn()`: a prompt, tool call, or tool result
  after the last final reply) counts if the session is open or changed in the last two minutes.
  `checkLive()` re-checks every 5 seconds between full syncs, re-reading only changed files.
  `liveCards` remembers which cards the sync moved, so it moves them back when the turn ends and
  leaves cards the user put in those columns alone.

When a card is opened, `loadTranscript(card)` calls `getSessionMessages(sessionId)`
and replaces its thread with `transcriptToThread()` from `lib/transcript.ts`, keeping the
last 400 items. That function drops user messages the person didn't type (`is_meta`,
`isCompactSummary`, origin kinds in `NOT_TYPED`, task notifications, interruptions),
strips embedded `<system-reminder>` and `<user-prompt-submit-hook>` sections, turns
`<bash-input>` into `! …`, shows slash commands the user typed but not completed local
commands (like `/clear`) or their output, and attaches each `tool_result` to its `tool_use`
by id. Images go through `lib/thread-media.ts` into the attachments folder, and PNG, JPEG and GIF end up as WebP
(`lib/attachments.ts`, `sharp`, quality 85) on every way in; SVG and non-image files keep their original bytes, and a raster
`sharp` can't decode is kept as it was:
- composer uploads (`saveAttachment`): converted before the response, the original removed;
- live tool screenshots and the pane thumbnail after each turn (`saveImageData`, async): the WebP comes back and no
  original is kept (`liveToolResult` in `lib/thread-media.ts` makes `handleToolResults` in `lib/runner-turn.ts` wait for it;
  text-only results still store at once);
- images a transcript read picks up (`saveAttachmentData`, sync, so it can't wait): the original is written, a WebP is made
  beside it in the background, and the next save of the same bytes returns the WebP. Threads may still point at the original.

`scripts/webp-backfill.mjs` converts what was saved before this (`--convert` is safe while Weft runs; `--rewrite` needs Weft
quit, points `board.json` and `threads/` at the WebP copies and deletes each original that nothing else, such as a
`~/.claude/projects` transcript or a saved page, still mentions). Screenshots in tool results become the tool
item's `images`, images pasted into Claude Code become inline
`![…](path)` refs in the user's text, and local files the agent shows with `![…](path)` are
copied in and the ref rewritten. `transcriptAt` records what was read, so unchanged sessions aren't re-read. A card
Weft has open (`warm`) keeps its own live thread.

`activeElsewhere()` in `lib/runner.ts` decides whether writing to a picked-up session
would collide with another app. It says yes when the session changed outside Weft in the
last 10 minutes (`lastActivity` is more than 5 seconds past `lastWeftTurn`), or when it is
open in another app right now (`isOpenElsewhere`). Cards that already continued as a copy
never do. When it says yes, `sendMessage()` opens the CLI with `forkSession: true` and stores
`forkedFrom: <original sessionId>` on the card, so the original session is never written to
by two apps.

`lib/env.ts` (`cliEnv()`) builds the environment for every CLI Weft starts: it removes the
`CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, and related variables inherited from a Claude session
Weft was launched from, and sets `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, so Weft's own sessions
don't appear in the Claude app's session list.

## Status strip

`components/StatusStrip.tsx` shows a thread's numbers under the reply box (`ReplyBox`): project folder and branch, model, context left, prompt cache warmth, tokens, changed lines, and the plan's 5-hour and weekly quota with reset times. The data is `card.stats` (`CardStats` in `lib/types.ts`), written by `lib/runner-turn.ts`:

- After each turn, `turnStats()` fills the model, tokens and context fill from the result's `modelUsage` and the last main-agent request's usage, and `changedLines()` / `gitBranch()` read `git diff HEAD --numstat` and the branch from the folder.
- **Prompt cache.** `handleAssistant()` runs each main-agent request's usage through `cacheAfter()` (`lib/turn.ts`) into `session.cache` (`CacheState`: request time, lifetime, cache-hit share, size in tokens); `turnStats()` saves it as `stats.cache`. The lifetime is read from what the request wrote (`ephemeral_1h_input_tokens` means an hour, `ephemeral_5m_input_tokens` five minutes). The strip's `Cache` chip counts the minutes left (`cacheMinutesLeft()` in `lib/format.ts`, ticking on `useNow`) and turns to `cache:cold <size>` once it lapses: the next message resends that many tokens at full price instead of about a tenth. The size is also the context fill, so it replaces the old `contextTokens`.
- `refreshLimits()` calls the SDK's experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` at CLI init and after each result to get the 5hr/7d windows (null on API-key logins). `rate_limit_event` messages update the same fields when they carry a utilization. A failure leaves the limits blank.
- Quota is account-wide, so the bottom bar takes it from the most recently updated card via `latestLimits(cards)` in `lib/board-view.ts`, which returns the latest card's full `CardStats` plus its `cwd` and `backend` (`(CardStats & { cwd: string; backend: Card["backend"] }) | undefined`) so the bar can show "last thread: <folder> [model] 5hr/7d" when no card is open. `components/Board.tsx` derives `footerStats`, `footerCwd` and `footerBackend` from that result and passes them down.
- `StatusStrip` takes an optional `backend?: Backend` prop. When `backend === "puku"`, the model label uses puku purple (`text-puku`) instead of warn amber, and when no `stats.model` is reported puku still renders a `[puku]` label with a "Backend: puku-cli" tooltip so the strip isn't blank.
- Native `title` tooltips don't show in the desktop app, so `Tip` draws its own bubble in a portal, clamped to the window.

## Review tour

A thread that finishes work for review ends its reply with a fenced `weft-review` JSON block (the instruction is `REVIEW_PROMPT` in `lib/review.ts`, appended to every board thread's system prompt in `queryOptions()`, `lib/runner-session.ts`). `lib/runner-turn.ts` strips the block from the visible text and saves the parsed plan on `card.review`: `url` (where the app runs), `dev` (the command that starts it), and `steps`.

While the card is in Review, `components/ReviewPanel.tsx` sits at the bottom of the thread, in place of the reply box (`footer` and `replaceReply` on `ThreadView`). A card with no plan keeps its reply box with a "Build review tour" strip above it. It shows one step at a time with what to look for, "Looks good, next" and previous/next buttons, an **Open browser** button, and a feedback box that sends the note to the thread. A new plan restarts the tour.

- **A step's page** (`stepUrl` in `lib/review.ts`): its `path` as a full URL, an absolute media/file path (opened as `file://`), or a path on the plan's `url`. A step with no `path` uses the first URL or file path in its `look` text, then the plan's `url`. A plan with no `url` falls back to the local app the thread mentioned most.
- **Dev server** (`lib/devserver.ts`, `app/api/cards/[id]/dev/route.ts`): when the plan has `dev` and `url`, the tour asks the server to start the command in the card's folder unless the url already answers, polls its status every 3 s, and shows running/starting/crashed with Start/Restart buttons. Servers Weft started are stopped when Weft exits.
- **Self-check**: the `weft:preview` skill (`plugin/skills/preview`) starts the server, confirms the page renders, and gives the url and start command for the plan.

## Browser per card

The browser pane keeps one page per card (`views` in `electron/browser-pane.cjs`, keyed by card id; `"board"` when no card is open). `Board` calls `browser.setActive(selectedId)`, so opening a card shows its page (if it has one) and closing the card hides the pane. `browser.open(url, cardId)` from the board activates that card's browser; agent tools (`browserMcpServer(() => session.cardId)` in `lib/browser-tools.ts`) pass the card id to the control server and load into their own card's browser without taking over the screen. `browser.prune` closes the browsers of deleted cards.

`BROWSER_PROMPT` also tells every thread to show something current there on every turn, quick answers included: with no app page yet, it renders its work (commits, plans, diffs, test runs) as an HTML file under `~/.weft/show/` (`SHOW_DIR`, `lib/show-dir.ts`; it was `/tmp/weft-show/` until macOS kept clearing it) and opens it with `open_url`.

## Prompt search

The command palette (Cmd+K) searches the prompts the user wrote. `lib/search.ts` keeps a SQLite FTS5 index (`~/.weft/search.db`, via `node:sqlite`; the type shim is `node-sqlite.d.ts`) with one row per typed prompt. It indexes every Claude Code session file from `sessionFiles()` in `lib/import.ts` (keyed `session:<id>`) and every Weft thread file in `~/.weft/threads` (keyed `card:<id>`). `typedPromptOf()` in `lib/transcript.ts` picks the typed text out of a raw `.jsonl` record, with the same filtering as `transcriptToThread`. Session files are append-only, so the `sources` table stores a byte offset per file and each pass reads only the new lines; thread files are re-read when their mtime changes. `startSearchIndex()` (called from `prewarm()`) runs a pass at start and then every minute.

The index covers everything, but `searchPrompts()` only returns prompts from cards on the board: it maps each card to its `card:` and `session:` keys, passes them to the query as a JSON list, and leaves out the copilot. Results are ranked by bm25, de-duplicated per card (a Weft-run card is in the index under both keys), and capped at 2 prompts per card and 20 cards. Every query word must match and the last is a prefix. `GET /api/search?q=` returns `{ hits, indexing }`; `indexing` is true until the first pass over the sessions has finished. Snippets mark matched words with `\u0001`/`\u0002`, which `CommandPalette` renders in bold under a "Prompts" group. Choosing a hit opens its card.

# Thread guards

Every board thread runs behind one guard set, whatever its CLI: a stripped environment and a set of hooks that turn
away tool calls no permission mode should allow. They run before a call (`PreToolUse`), so they deny it before it
runs, in every permission mode (bypass included), and the denial's reason goes back to the model as the tool result.

## One guard layer, every CLI

The guards live in `lib/guards/`, apart from any one CLI:

- `hooks.ts` `guardHooks(otherTurns, cardId)` is the guard set: one list of hooks per event (the table below).
- `decide.ts` `decide(hooks, call)` runs it on one call in Claude Code's terms (`tool`, `input`, `cwd`, `id`) and folds
  what the hooks said the way the Agent SDK does: any deny wins, then any ask, then allow (with any context or
  feedback for after the call). Matchers read as Claude Code reads them (`matches()`).
- `ask.ts` `askAboutCall()` is what an ask becomes: the card asks you in the guard's words (outside folder, another
  card's symbol), with the one-shot retry grant and granted-folder reads first. The SDK's `canUseTool`
  (`lib/runner-session.ts`) and the guard route both call it, so an ask looks the same on every CLI.

Each CLI reaches the set through its own enforcement point:

| CLI | How the guards see a call | Adapter |
| --- | --- | --- |
| Claude Code, puku-cli | Agent SDK in-process hooks (`Options.hooks`) | `lib/env.ts` `guardedCli()` |
| Codex 0.162 | its own `PreToolUse`/`PostToolUse` hooks, given per turn on the command line | `lib/guards/codex.ts` |
| Goose 1.56 | an open-plugin's `hooks/hooks.json` in the card's Goose state root | `lib/guards/goose.ts` |

Codex and Goose hooks are commands, so their calls come to Weft over HTTP: the hook runs an inline `curl` to
`/api/guards/<cli>/<event>` (`app/api/guards/[cli]/[event]/route.ts`) with the turn's bearer token
(`lib/guards/turn.ts` `openGuards`), and `lib/guards/hook.ts` `answerHook` maps the payload to Claude Code's tools
(`lib/guards/calls.ts`: Codex's `Bash`, `apply_patch` split per file by `lib/guards/patch.ts`; Goose's `shell`,
`write`, `edit`, `tree`, `read_image`, `analyze`), runs `decide()`, waits on the card for an ask, and prints the
answer in the CLI's words (`lib/guards/answer.ts`). Codex reads Claude Code's own hook output; Goose reads
`{"decision":"allow"|"block","reason"}`.

- **Codex**: `--enable hooks` (on even if your `config.toml` turned it off), `--dangerously-bypass-hook-trust` (Codex
  asks you to trust a new hook in its TUI; `codex exec` has none, and Weft wrote the hook), `hooks.PreToolUse` and
  `hooks.PostToolUse` with `matcher="*"` and `timeout=3600`, and `shell_environment_policy.exclude` so the guard and
  MCP tokens stay out of the model's shell (hooks still get them). Nothing is written to `~/.codex`.
- **Goose**: `<GOOSE_PATH_ROOT>/.agents/plugins/weft-guards/` (`.plugin/plugin.json`, `hooks/hooks.json` mode 0600,
  matcher `.*` on `PreToolUse`, `PostToolUse` and `PostToolUseFailure`, `timeout` 3600), written before the turn and
  its hooks removed after. The token is written into the file, not Goose's env, which its shell would show.

**Fail closed.** A turn whose guards can't be installed doesn't start: `openGuards` throws `GuardsUnavailable` without
the server's port or a card, and `openGooseGuards` when its plugin can't be written; the card says why. Both CLIs let a
call through when their hook can't run or times out (verified on 0.162.1 and 1.56.0: a hook without its exec bit, and
Goose's 30-second default), so the hook is inline (no script file to lose), prints a refusal when Weft doesn't answer
(server down, turn closed, timeout: `UNANSWERED`), both hooks get an hour, and the route refuses an ask nobody answers
a minute before that (`ASK_LIMIT_MS`). A guard that throws refuses the call too.

**Cost.** Opening the guards adds nothing slow to a turn's start: a random token, and for Goose two small files. Each
tool call on Codex or Goose adds one local `curl` round trip, ~5 ms warm on the dev server (4-11 ms over 20 calls,
measured 2026-10-27; the route's first call after a restart compiles it, ~0.3 s), plus the guards' own work, which
Claude Code pays in-process too.

**Proof.** `lib/guards/parity.test.ts` sends the same four calls as Claude Code, Codex and Goose make them (read `.env`,
`git reset --hard`, kill Weft's server while another card runs, write outside the card's folder) through the real
guard set: each is refused, or asked about, in the same words on all three.

| Hook | File | Turns away |
| --- | --- | --- |
| Secret guard | `lib/secret-guard.ts` | reading `.env` files, Weft's data secrets, a Weft Worker's home ([what's sealed](weft-worker.md#whats-sealed-on-a-worker)), environment dumps (Bash, Read, Grep…) |
| Restart guard | `lib/restart-guard.ts` | killing or restarting Weft's own server, app or port while other cards' turns run; points the thread at `mcp__board__restart_weft_when_idle` |
| Git guard | `lib/git-guard.ts` | git commands that throw away or hide uncommitted work in the shared tree |
| Route import guard | `lib/route-import-guard.ts` | an edit that makes a route file import a module that isn't there yet |
| Prerender check | `lib/prerender-check.ts` (run by the route import guard) | a route segment config export `next build` refuses under cacheComponents; warns (doesn't deny) on runtime data awaited outside `<Suspense>` |
| Import guard | `lib/import-check.ts` | (PostToolUse) reports an edit that breaks an import |
| Dropped-import check | `lib/dropped-imports.ts` | (PostToolUse, with the import guard) reports an edit that drops an import the file still uses |
| Symbol claims | `lib/claim-guard.ts` | asks (doesn't deny) before an edit to a symbol another busy card is editing |
| Bash claims | `lib/bash-claims.ts` | asks before a Bash line that writes a claimed file; claims what Bash wrote, drops claims on clean files, tells a failed check whose failures are another card's |
| Folder gate | `lib/folder-guard.ts` | asks (doesn't deny) before a file tool or Bash command reaches a folder outside the card's project |

## The local API's own gate

`lib/guard.ts` guards `app/api/*`: Host must be local, and once the desktop app has written a launch token, **every** route needs it —
reads included. Writes additionally accept the plain `x-weft-token: 1` a thread's `curl` sends for ordinary board moves, but a read needs
the token itself or that `1`. Writes that grant power (`elevated()`: a permission answer, settings, folder grants, `!` shell, a card's mode
or read scope) refuse the `1` and need the token. So a process that only reaches the port — a browser extension, a malicious `postinstall`,
any other local app — can neither read the board (its project paths, the profile, the names of the secrets in the vault) nor write to it;
only Weft's own window can.

There is no per-route "sensitive" flag any more: it existed when reads were unauthenticated and marked the six routes that leaked
(account, account/team, account/billing, settings, services, github/collaborators). The desktop app adds the token to the board window's
own requests only, never a frame's (`electron/api-token.cjs`, a `webRequest` hook on the default session; the browser pane is another partition), and it is
the control server's token, which threads can't read. The one thing the pane gets is the plain read value `1` on GET/HEAD of
`/api/attachments/*` on both `127.0.0.1` and `localhost` at Weft's port (`attachPaneAttachments`; Next names its own origin `localhost`, which the commit walk-through's picture links use), so a page a thread opens can show a card's pictures: an `<img>` can't send a header. With no token on disk the API fails closed (`lib/guard.ts`): a read without `1` and every elevated write get 403, since main writes the token before it starts the server (`electron/main.cjs` `boot`), so a missing file means something is wrong, not a first launch. Only Vitest and a server started with `WEFT_NO_TOKEN=1` (`pnpm dev` / `pnpm dev:web` in a plain browser, which set it) run without one.
`weft://reply|commit` links act only from a real file under `~/.weft` (`ownPage`, `electron/page-links.cjs`).

## Auto mode's classifier denials

In `auto` mode the CLI's classifier decides each call before Weft hears of it. A call it can't decide on comes to
`canUseTool` as a normal prompt; a call it **denies** never does (the SDK has no option that routes a classifier deny
to `canUseTool`, checked against `@anthropic-ai/claude-agent-sdk` 0.3.293). Before this, a card whose migration the
classifier read as a production deploy showed nothing, while the thread told you to "approve it" and every retry was
declined silently.

What the CLI does send is a `system`/`permission_denied` message (`decision_reason_type: "classifier"`, the classifier's
`decision_reason`, the `tool_use_id`), and the turn's `result.permission_denials` carries each denied call's input.
`lib/classifier-denial.ts` uses both:

- `noteDenial` (from `handleSystem` in `lib/runner-turn.ts`) keeps each classifier denial on the session; other deciders
  (rules, `dontAsk`) and subagents' calls are left alone.
- When the turn ends (not stopped), `askAboutDenials` turns each distinct call into a `Pending` with
  `why: { category: "classifier", detail: <reason> }`, so the card goes to Needs you with the ordinary prompt UI; the
  queued-message handoff waits for it as it does for a Needs you status.
- `components/PermissionInput.tsx` shows that reason as **Auto mode blocked** with **Allow once and retry** and
  **Keep denied**. Once the last of them is answered, an allowed call becomes a one-time grant (keyed by tool name plus
  its input with sorted keys) and Weft sends the thread "retry exactly that call"; with nothing allowed the card goes back
  to the column the turn ended in.
- `withRetryGrant` adds a PreToolUse hook that answers `allow` for the granted call, which skips the classifier, and
  uses the grant up. `canUseTool` checks the grant too, in case the retry asks instead. A deny hook (the secret guard, say)
  still wins, and a grant the retry turn didn't use is dropped when that turn ends.
- Auto mode marks some calls **classifier-only**: hook allows and allow rules don't count for them, and when the
  classifier gives no verdict ("it skipped this action", a hard failure) the CLI denies them with no prompt fallback,
  so the PreToolUse allow alone let the retry be blocked again. So before the retry message goes out, the live CLI
  steps out of auto mode into `default` (`query.setPermissionMode`; the card's saved mode stays `auto`), the hook
  stands aside (`session.retryOutOfAuto`), and the retry reaches `canUseTool`, where the grant allows it. The CLI goes
  back to the card's mode once the last grant is used, or when the retry turn ends.
- A reply instead of a click (`sendMessage`) drops the prompts and marks them denied in the thread.

The mode's hint in `MODE_OPTIONS` (`lib/types-card.ts`) says this: "A classifier approves or blocks; Weft asks you about blocks".

## MCP elicitations

An MCP server can stop mid-call and ask the user something (an MCP *elicitation*): the Supabase MCP confirms an
`execute_sql` or `apply_migration` whose SQL it calls destructive (a `drop trigger`, an `update` with no `where`), and
other servers ask for a form's values or send you to a URL. The CLI hands each one to the SDK's `Options.onElicitation`;
with none set, the SDK **declines it automatically**, so before this the card never showed a prompt and the tool came
back `{"status":"declined"}` in every permission mode (seen 2026-10-24). Permission rules and modes don't touch it:
it's the server asking, not a tool call.

`queryOptions` in `lib/runner-session.ts` now sets `onElicitation` (`lib/elicitation.ts`):

- A spare with no card yet declines (nobody to ask). Otherwise the request goes through `askUser` as a `Pending` named
  `mcp__<server>__elicitation`, titled with the server's permission-display `title` or `<server>: <message>`, carrying
  `elicitation: { server, message, mode?, url?, fields }`. The card goes to Needs you like any prompt, with no edit
  preview or reason chip.
- `elicitationFields` reads the `requestedSchema` into fields: text, number, integer, boolean, a choice list (`enum` with
  `enumNames`, or `oneOf`/`anyOf` of `{ const, title }`) and a multi-select (`type: "array"`), each with its title,
  description, default and whether it's required. A `url`-mode request has no form, just the link.
- `components/ElicitationForm.tsx` (inside `PermissionRequest`, `components/ThreadFooter.tsx`) shows the server, its message,
  the link and the fields, with **Accept** (or **Submit** for a form) and **Decline**. The board card's own row says
  Accept / Decline for a request with no form; a form is answered from the thread.
- Answers go through the ordinary permission route as strings (`answers`). `answerPermission` checks them first with
  `elicitationContent`, which types each one for its field and refuses an empty required field or a value that doesn't
  fit, so the board gets a 409 and you can answer again. `elicitationResult` turns the settled prompt into the server's
  answer: `accept` (with the typed `content` when there was a form), `decline` for Decline, and `cancel` when the call
  was stopped before anyone answered.
- Codex (`codex exec`, no interactive approvals) and Goose have no channel for an MCP server's prompt mid-call, so this
  is Claude Code and puku-cli only. (Weft's own guards do ask on them: the guard route holds the hook, above.)

## Folder gate

A thread works in its card's project folder. `lib/folder-guard.ts` is a PreToolUse hook (Read, Edit, MultiEdit,
Write, NotebookEdit, Glob, Grep, LS, Bash) that answers "ask" when a call reaches anywhere else, whether or not macOS
would refuse it, so Weft, not the OS, decides. The paths come from the tool's file or folder argument (`pathsOf`); for
Bash, from every absolute, `~/`, `$HOME` and `../` token in the command (a quoted token runs to its closing quote and
`\ ` escapes a space, so a project in `~/My Drive` isn't read as `~/My`), and only those under the user's own files
(home, `/Users`, `/Volumes`), a heuristic that can't see a path a script builds. Paths are resolved first (`~`, `..`,
symlinks, a file not created yet by its nearest folder).

- **Never asked about**: the project (an isolated card's worktree, for it), `card.readScope`, `settings.allowedFolders`, Weft's data folder (`~/.weft`, but not `~/.weft/worktrees`: another card's worktree asks like any other folder),
  `~/.claude`, temp dirs, `/dev`, `/tmp` and the system's tool and library paths.
- **The prompt** reads "Outside the project: read ~/Downloads" with an **Outside project** chip. The folder is the call's
  project root (nearest ancestor with a `.git`, `package.json`…, below home), else the file's folder, never home itself
  (`grantRoot`). `folderAsk` carries the question, reason and folder from the hook to `canUseTool`
  (`lib/runner-session.ts`), whose `askUser` puts the folder on the pending request as `readScope`.
- **Buttons** (`PermissionActions`): **Allow once**; **This card** (`PATCH /api/cards/:id { readScope }`, the card's
  `additionalDirectories` from the next session, and the folder guard reads it live for the current one: no `/add-dir`
  turn, which the SDK CLI refuses); **Always** (`POST /api/folders`
  → `settings.allowedFolders`, which every new session also gets as `additionalDirectories`); Deny.
- **A card on another machine** (a worker's, or a Mac's card opened on weft.zip): the same three buttons, with a different
  path. A grant goes **inside the answer command** as a scope (`grant: "card" | "always"`, `ThreadTransport.grantInAnswer`),
  never as a path and never as a second command. The machine running the card applies it in `lib/cloud-inbox.ts` or
  `lib/worker-daemon.ts`: `answerGrant` (`lib/cloud-commands.ts`) reads the folder from its own `card.pending`, and
  refuses a stale `pendingId`, a question, an MCP form or a prompt with no folder, rather than fall back to Allow once.
  The answer runs first and `applyFolderGrant` (`lib/folder-grant.ts`) writes after it, so a request that has gone leaves no
  grant. Always means that machine: its own `settings.allowedFolders`, not this Mac's. `answerBody` drops a grant on a
  Deny. A question's "Read from" stays local: its folder is guessed from the model's words and a question's answers
  skip the signed-approval rule, so it must not buy a standing grant.
- **`elevated()` for those answers**: `POST /api/worker-board` takes an `answer` only with the launch token, like the local
  permission route, so a thread's `curl` with the plain `1` can't approve its own prompt on a worker. A reply or a Stop
  still needs only `guard()`. On a Mac, a grant passes `approvalProblem` first (`lib/approval-check.ts`), and a phone's
  signature covers it (`lib/approval-sig.ts`).
- **After a grant**, a read-only call (Read, Glob, Grep, LS) whose paths are all in granted folders is allowed with no
  prompt at all (`grantedRead`), including the CLI's own working-directory prompt; writes and Bash in a granted folder
  follow the card's permission mode as usual.
- **Taking it back**: Settings → Security's **Trusted folders** row lists `settings.allowedFolders` (it rides along in
  `SettingsView`), **Add folder** opens the OS dialog (`window.weft.dialog.openFolder`, the one the project and repo
  pickers use) and grants through the same `POST /api/folders` the **Always** button calls, and **Remove** calls
  `DELETE /api/folders` → `unallowFolder`. Until that row existed, "Always" was a one-way door — a folder trusted once
  could never be untrusted. The revoke takes effect for new work; a card already holding the folder in `readScope` keeps
  it until that turn ends, since a permission already handed out isn't retracted. `allowFolder` dedups with a `Set`, so
  re-adding a folder already on the list is a no-op rather than a second row.
- **Not covered**: the copilot and the macOS layer (Codex and Goose are, through the guard route above). If the OS still says "Operation not
  permitted" after Weft allows it, that's `mcp__board__request_folder_access` (`electron/folder-access.cjs`), and the
  grant macOS needs is for the app that actually runs (dev Weft is `Electron.app`, not the `~/Applications/Weft.app` launcher).

## Symbol claims

Cards in one folder share a working tree, so two threads can edit the same function at once and fold their work
into each other. Claims catch that at the moment it happens, instead of a standing "also running here" line.

- **What a card claims** (`claimsFor` in `lib/claim-guard.ts`, `lib/symbols.ts`): for an Edit or MultiEdit on a
  TS/JS file, the hook reads the file, finds each `old_string` (every match with `replace_all`) and parses it with
  `ts.createSourceFile` (no type-checker). Each top-level statement the match overlaps, with its leading comments
  but not the blank lines after it, gives a claim `<real path>#<name>`: functions, classes, `const` components
  (destructured names too), types, interfaces, enums, namespaces, and `default`. Imports and `export … from`
  are never claimed. The whole file (`<path>#*`) for Write, NotebookEdit, other files, an `old_string` that isn't
  there (a MultiEdit edit that depends on an earlier one), a nameless statement (a bare call), or more than five
  symbols in one edit (a restructure: each symbol would be noise). Paths are real paths, the way git names them,
  with `#` and `%` escaped (`%23`, `%25`) so a key's first `#` starts the symbol.
- **Nested claims** (`NEST_LINES = 150` in `lib/symbols.ts`): a top-level symbol over 150 lines would be a whole-file
  claim in practice (Board() once ran from line 125 to 1013 of `components/Board.tsx`, before it was split into `lib/` hooks and layer components), so the walk goes inside it and claims the
  statement holding the edit, then again inside that one if it's long too. Function and method bodies split into
  statements, classes into members, a JSX element (a `return (…)`, an arrow's JSX body, `{items.map(…)}`) into its
  children, and a call into its function argument's body (`memo(function …)`, `useEffect(() => …)`, `describe(…)`).
  Each part is named by what it declares (`moveFocus`, the first name of a destructuring: `open` for
  `const [open, setOpen] = useState()`), the call it makes (`useBoardEvents`, `ipcMain.handle`), its JSX tag
  (`Header`, the first tag inside `{open && <Dialog/>}`), or its kind (`return`, `if`, `for`, `fragment`, `text`).
  A name that repeats among siblings gets its order: `useEffect#1`, `useEffect#2`. Keys join the path with `/`:
  `Board/return/main/Item#43`. An edit to the long symbol's own lines (its signature, its closing brace) claims it whole.
  A claim clashes with one inside it, so `Board` and `Board/moveFocus` clash, and `Board/moveFocus` and
  `Board/paletteItems` don't. Order numbers shift when a sibling of the same kind is added above, so two claims on
  one `useEffect` can miss each other after such an edit; the next edit's claim is current again.
- **When it asks** (`lib/claims.ts` `findClash`): another card that's busy (`isBusy`) in the same tree (`sameTree`)
  holds the same symbol, or either side covers the whole file. The PreToolUse hook answers `ask` and the card's
  permission prompt reads "Card ‘<title>’ is editing <Symbol> in <file>. Wait, or go ahead?" (`claimQuestion`,
  used as the prompt title in `lib/runner-session.ts`). It reads board data and the one file; no git.
- **What the prompt shows** (`lib/edit-preview.ts`, `components/PermissionInput.tsx`): any held Edit, MultiEdit,
  Write or NotebookEdit, from a claim clash or any other permission prompt, reads as a change instead of the tool's
  JSON: the asking card's title, the file (relative to the card's folder; "creates" for a Write to a new file), the
  symbols it touches (`claimSymbols`, the keys the PreToolUse hook already worked out, so no second parse; left out
  for a whole-file claim), +added −removed and a line diff (common lines as context, LCS in the middle, plain −/+
  past 250,000 cells, first 40 lines). `askUser` (`lib/runner-ask.ts`) builds it as `pending.edit`; a Write diffs
  against the file on disk. **Raw** shows the JSON. Other tools still show their input as JSON.
  Above it, **why the prompt came up** (`pending.why`, a `PromptReason`): a category chip and a one-line detail.
  For a claim clash `clashWhy` (`lib/claims.ts`, kept by the PreToolUse hook, read with `claimWhy`) picks **Same code**,
  **Overlapping code** (one symbol inside the other) or **Whole file** (either side claims it), with "‘<card>’
  (running | waiting | waiting on you) has uncommitted edits to <symbol>". Any other prompt is **Permission mode**, "<mode> asks
  before <tool>" (`modeWhy` in `lib/runner-ask.ts`, labels from `MODE_OPTIONS`). The explanation every clash shares
  (one working tree, going ahead can undo their uncommitted change) is the chip's tooltip, `REASONS` in the component.
- **Wait** (`lib/permission-wait.ts`, `PermissionActions` in `components/PermissionInput.tsx`): a clash prompt's
  buttons are **Wait** (first), **This first** and **Others first** (a plain **Go ahead** stands in for This first on weft.zip).
  Wait (`POST /api/cards/:id/permission { wait, pendingId }`)
  keeps the edit held, marks it `waiting`, moves the card back to Running ("Waiting for ‘<holder>’") and polls every 3 s
  (`checkWaits`). Once the holder lets go (no longer busy, archived or deleted, or its claim dropped because its change
  was committed), the held edit is denied with a message telling the thread to re-read the file and redo the edit on top
  of that change: the old_string it planned to replace may be gone, and a Write would clobber it. This first and Others
  first still answer it while it waits. Waits live in memory; a restart ends the turn and them with it. A wait is
  checked against the wait graph first (**No wait closes a loop** below), so **Wait** never starts a deadlock.
- **Waiting by itself** (`askUser` in `lib/runner-ask.ts`, `startWaiting` in `lib/permission-wait.ts`): a clash prompt
  doesn't park the card in Needs you at all. The card is already editing code another card holds, so the answer is
  almost always "wait": the card goes straight to Running with the request marked `waiting`, and the watcher starts
  with it. The buttons stay where they were — **This first** and **Others first** in the thread's prompt and on the card —
  so the wait can still be cut short. Every other prompt (the card's permission mode, an outside folder, a question)
  still parks in Needs you, because those really need the user; so does a thread whose own
  `BOARD STATUS: column=needs_you` asks for something. A waiting card reads as held, not as working: a lock instead
  of a spinner, and Needs you's amber border.
- **This first / You first** (`lib/precedence.ts`, `lib/yields.ts`, `lib/waits-on.ts`, `components/YouFirst.tsx`): the user
  can put the held card ahead of the holder. **This first** sits on the held card's prompt and on its card, beside Wait (and
  alone with Others first while it waits). It replaced Go ahead: going ahead on code another card holds now always tells that
  card to leave the file, since an edit going in under a thread that doesn't know is what tangles two changes.
  **You first** is a one-line strip on the holder's thread, above its prompt, for each card waiting on it (`useWaitersOn`, fed from the board's card list in
  `lib/use-board-card-actions.ts`, so no props run through the thread components). Either posts
  `POST /api/cards/:id/permission { first, pendingId }` for the held card, and `putFirst`:
  1. gives the held card a whole-file claim on the file (`/abs/Login.tsx#*`) and drops any yield it had to the holder;
  2. puts `{ to, file }` on the holder's `card.yields`, so `findClash` skips the holder's claims on that file for the
     first card (its edits there stop asking), while the holder's own edits there clash with the whole-file claim and
     wait on it like any clash, marked `first` ("Card ‘X’ goes first on Login.tsx. Wait, or go ahead?");
  3. tells the holder at once through a mid-turn message (`lib/runner-steer.ts`, "Weft: the user put card ‘X’ first on
     Login.tsx…"), so it moves to other work instead of finding out at its next edit; Codex and Goose holders, which
     can't be messaged mid-turn, find out at their next edit there;
  4. answers the held edit with allow.

  A yield lasts while the first card is busy and still claims the file (`yieldHolds`): its commit drops the claim and
  so the yield, and its turn ending does too. `pruneYields` runs in both claim guards before `findClash`, so a stale
  yield never outlives that. Pressing This first on the holder's own held prompt turns the order around the same way.
  The clash prompt shows both faces before its reason chip (`components/CardFace.tsx`: thumbnail, else emoji, else
  initial; `clashWhy` copies the holder's `emoji` and `thumb` onto `why.holder`), holder first, then this thread, so
  who is in whose way reads at a glance without a new row. weft.zip's transport leaves `putFirst` out, like Wait.
- **Others first** (`putHolderFirst` in `lib/precedence.ts`): the other way round — the card holding the code goes
  ahead, and this card waits for it. It posts `POST /api/cards/:id/permission { otherFirst, pendingId }`, and:
  1. checks `wouldGridlock` against the live wait graph **before** it yields anything (see **No wait closes a loop**
     below); a wait that would close a loop is refused, and the card goes ahead instead;
  2. puts `{ to: holder.id, file }` on this card's `card.yields`, so the holder's edits there skip this card's claims
     (`findClash`), and this card's own later edits there clash and wait on the holder;
  3. waits the held request (`waitPermission`), the same hold **Wait** uses, so it is released when the holder lets go.

  The wait can still be refused after the yield is written (the holder let go in between), so the yield only stays
  when `waitingOn(cardId, pendingId)` says the request really is waiting on the holder; otherwise it is taken back
  with `withoutYield`, so a refused wait leaves the file the other way round.

  On a clash the button is the order, not a refusal, so **Others first** replaces **Deny** there; **Deny** stays for
  prompts that aren't a clash (the card's permission mode, an outside folder, a classifier block), where refusing the
  call is the question.
- **No wait closes a loop** (`lib/wait-chain.ts`, `breakGridlock` in `lib/permission-wait.ts`): two cards can wait on
  each other — A holds f.ts, B holds g.ts, B's edit of f.ts waits for A and A's edit of g.ts waits for B. Neither is
  ever released: a wait only ends when its holder stops being busy (`releasedBecause`), and both stay busy forever.
  That is gridlock, and no button can break it, because both cards are already waiting and the order buttons only
  re-point the yields.

  So a wait may only be taken on a holder that isn't already waiting on this card, directly or through other cards.
  The wait graph is read from the live sessions (`liveWaitTargets`: every waiting request a session holds and the
  holder it names — a card with two waiting requests holds two edges, and a loop through the second is a loop just
  as much), so a wait is checked against the chain as it stands at that moment. When the chain from the
  holder leads back to this card, the loop would close, so the wait is refused and the card **goes ahead** instead:
  it takes the whole-file claim, the holder leaves the file to it, and the holder is told mid-turn ("…waiting back
  would leave you both stuck, so ‘X’ goes first…"). The holder was the one waiting on this card, so it is the one
  that can be released — one of the two always keeps running. This is the same path **Others first** takes, so it
  applies to the automatic wait too (`askUser` in `lib/runner-ask.ts` starts a wait by itself): the gridlock never
  needs the user to notice it.

  Every wait goes through the check, including a request queued behind the one the card is showing
  (`startQueuedWaiting` in `lib/permission-wait.ts`): that one leaves the card's own state alone, since the request
  in front owns it, but it is still a wait and a loop is still a loop.

  The graph itself is pure and lives in `lib/wait-chain.ts` (55 lines), so it can be tested without a board:
  `waitTargets(waiting)` builds the **waiter → holders** `Map` (a card may wait on more than one); `waitsOn(targets,
  from, to)` walks the chain from `from` and says whether it reaches `to`, with a `seen` set so a graph that
  already loops ends the walk instead of hanging; `wouldGridlock(targets, cardId, holderId)` is the question that
  matters — would this wait close a loop? (a card waiting on itself counts); `gridlockChain(targets, cardId,
  holderId)` names the cards on the loop that would close — the chain the wait would run in, this card first and
  the holder last. `lib/wait-chain.test.ts` covers the logic (16 tests); the board's own behaviour is in
  `lib/permission-wait.test.ts`'s `describe("gridlock")` (5 tests).
- **The blocking stamp** (`lib/waits-on.ts`, `components/BlockingMark.tsx`): a card that other cards are waiting
  on carries a "blocking N" chip, so the card that went first shows what it is holding up. The count comes from
  the same published card list the **You first** strip reads (`publishWaits`, fed from the board's card list in
  `lib/use-board-card-actions.ts`): `waitersOf` groups the waiting cards by the card they wait on, and
  `useBlockingCount` reads that card's group size. Live, like the strip: when the waiters are released the chip
  goes with them. The chip sits in the card's mark row (`components/CardMarks.tsx`), so it costs no new row.
- **Released by the write, not by the commit** (`lib/blocking.ts`, `releaseOnWrite`): a card waiting on another's
  code used to be held until the holder committed or its turn ended, even though the change it was waiting for
  had already landed. Now the write itself releases it: the claim hooks call `releaseOnWrite` when the edit runs
  (`lib/claim-guard.ts`: every file the edit claimed) or when a Bash line writes files (`lib/bash-claims.ts`: every
  file the card claims), and the waiting card is answered with a message naming the holder and the file and
  telling the thread to re-read it and redo the edit on top (`writeMessage`). The file is the unit, not the
  symbol: the waiter waits on the holder's claim key, so the whole file is released.
- **Recording**: the PreToolUse hook keeps what the edit will claim by tool use id, and the PostToolUse hook puts
  it on `card.claims` (most recent first, last 50) once the edit has run, so a denied edit claims nothing.
- **Dropping**: `updateCard` (`lib/store.ts`) clears a card's claims when it reaches Done or is archived;
  `lib/pile-commit.ts` calls `releaseClaims` for the paths it committed, on every card (the whole file went in).
  After every Bash call in a git repo, `releaseClean` (`lib/bash-claims.ts`) drops every card's claims on files
  `git status` no longer lists, so a thread's own `git commit`, a checkout or a revert releases them too.
- **Bash** (`lib/bash-claims.ts`, `lib/bash-writes.ts`, `lib/bash-writers.ts`, `lib/dirty-files.ts`, `lib/failure-owners.ts`): before a Bash
  call, the files its line names as written (`>`/`>>` targets, `sed -i`, `perl -i`, `tee`, `cp`/`mv`/`rm`/`touch`,
  `prettier --write`, `eslint --fix`, also through `npx`/`pnpm exec`) are checked as whole-file claims and ask on a
  clash like an edit. After it, the repo's dirty files whose mtime is past the call's start become this card's
  whole-file claims, except ones another busy card already claims (most likely its edit, made meanwhile); a
  formatter or codegen run is claimed this way even though the line names no file. But a file has only an mtime,
  not a writer: while this card's `pnpm test` runs, another card's `node gen.mjs` or a `puku-cli` it started writes
  files too, and those used to land on whichever card's call ended first (and hop to the next one once it went
  idle). So `lib/bash-writers.ts` keeps a window per Bash call, by tool use id, from PreToolUse to PostToolUse (a
  `run_in_background` call stays open 30 minutes, Bash's default background timeout, since its process outlives
  the call), and a written file is claimed only when this card's windows are the only ones open at its mtime, or
  the line names it as written. Otherwise its writer is unknown: no card claims it, and a failed check that names
  it hears "unknown", never another card's title. Codex and Goose cards open the same windows through
  the guard route, so their Bash writes are seen too. A failed check (`tsc`,
  `typecheck`, `test`, `lint`, `build` in the line, an error word in the output; Bash failures arrive as
  PostToolUseFailure, so the hook listens to both) gets `additionalContext`: the failing paths another busy card
  claims, with "leave those to that card", the ones whose writer is unknown, or else the files other cards have open, since a signature changed
  there can break a caller here. One `git status` per Bash call (~30–80 ms in this repo); not on the start path.
  What it can't fix: cards still see each other's half-done edits at run time. That's what opt-in worktrees are for.
- **Speed**: `typescript` loads on the first edit of a source file (~170 ms, once per server), never on the
  start-a-card path; parsing the 46 KB `Board.tsx` and walking it takes 5–13 ms warm, ~40 ms the first time.

### Markdown blocks and own-line commits

MAP.md, README.md and ROADMAP.md are edited by nearly every card, usually a bullet at a time. Two Edits on
different lines never collide, since each re-reads the file; the real risk is a commit, which takes the whole
file, carrying another card's half-written line.

- **Claims** (`lib/symbols-markdown.ts`): an Edit on Markdown claims blocks: a paragraph, table, fence or top-level
  list item, named by its h2-and-deeper headings and opening words (`File map/lib∕runner.ts`). Heading-only claims
  wouldn't do: MAP's File map is one section of 635 lines. The claim covers `old_string` and `new_string`, so a bullet
  inserted beside another is the card's own. Write still claims the whole file.
- **Commits** (`lib/commit-held.ts`): before a commit, for each Markdown path where another busy card holds blocks,
  the file is rebuilt as HEAD plus every hunk not in those blocks (a hunk in a block both cards hold stays in). The
  result is a blob, named in a note at `.git/weft-held/<sha of the path>` with HEAD and the working file's blob.
  commit.sh commits it through a temp index, then resets those paths in the real index. The held hunks stay in the working
  tree. A note whose HEAD or working file moved is ignored and the path commits whole, so a stale note can't
  revert a commit, and a failure only falls back to today's behaviour.
- **Why a note**: a warm spare's env is set before it has a card, so commit.sh can't know who's committing. The Bash
  guard does (`lib/commit-held-guard.ts`, on lines naming commit.sh, in the guard set every CLI runs); the page buttons call `holdBack` in `lib/pile-commit.ts`, and `releaseClaims` then drops only the committer's claims on a
  partly committed file.
- **Only busy cards hold lines.** A Review card is finished, and holding its lines would leave the commit
  walk-through nothing to commit. A bare `git commit -- file` isn't covered: it takes the whole file, as ever.

## Reading a command line

The Bash guards don't match strings: `lib/shell-parse.ts` reads the line the way the shell would, and
`steps()` in `lib/restart-guard.ts` turns it into every command it would run, each with the folder it runs in.
That covers `a && b; c | d`, `$( )` and backticks, `sh -c '…'`, a heredoc fed to `bash`, `eval`, `xargs`,
`sudo`/`env FOO=1` prefixes, and `cd x &&` carrying to the commands after it. The git guard uses the same walk.

## Git guard

Weft gives every card in a folder one working tree (no worktree per card, on purpose: see SOUL.md), so a git command
that discards or stashes uncommitted changes takes every card's work, not just its own. On 2026-10-12 one thread's
`git stash` took 112 files of the board's work out of the tree. The guard refuses:

- `git stash` with any subcommand but `list` and `show` (push, pop, apply, drop, clear, `-u`, …)
- `git reset --hard` (a plain or `-- paths` reset only touches the index and is fine)
- `git checkout -- <path>`, `git checkout .`, `git checkout <tree> <path>`, pathspec magic (`:/`, globs) and
  `git checkout -f`; a plain branch checkout is fine (git refuses it when it would lose changes)
- `git switch -f` / `--discard-changes`
- `git restore` unless it's `--staged` (`-S`) alone, without `--worktree` (`-W`)
- `git clean -f` (but `-n` / `--dry-run`)

An isolated card's own worktree (docs/architecture/worktrees.md) is its own: from inside it, `reset --hard`, path checkouts,
`restore` and `clean -f` on that worktree are allowed; `stash` stays refused (`refs/stash` is shared by every worktree),
and so do other trees, the main one included.

It reads git's own options first (`-C dir` moves the folder; `-c`, `--git-dir`, `--work-tree` skip their value), so
`git -C ~/dev/weft stash` is caught too. A folder under the temp folder (`os.tmpdir()`, `/tmp`, `/private/tmp`) is a
scratch clone no card owns, and is left alone.

The refusal says why and points to the safe ways:

- commit by path: `git commit -m '…' -- <your files>`
- or commit through a temp index: `GIT_INDEX_FILE=/tmp/idx git read-tree HEAD`, `… git add <files>`, `… git commit`,
  then `git reset -q -- <files>` so the real index matches the new HEAD
- read a clean copy of a file: `git show HEAD:path > /tmp/x`
- undo your own change by editing the file back, or ask the user to clean the tree

It also refuses what would let a commit skip the pre-commit hook: `git commit --no-verify` (`-n`), `git config
core.hooksPath <anything but .githooks>` or `--unset core.hooksPath`, and `git -c core.hooksPath=… <cmd>`. Reading the
setting is fine. Its refusal names the hook instead of the stash story.

Tests: `lib/git-guard.test.ts` (each refused form, the allowed ones, scratch folders, the hook), `lib/env.test.ts`
(it's wired into `guardedCli`).

## The pre-commit hook

`.githooks/pre-commit` runs `scripts/check-staged.sh` on what's staged, not the working tree, since other cards'
unstaged work lives in the same tree. `pnpm install`'s `prepare` script points `core.hooksPath` at `.githooks`. In order:

1. Secrets: gitleaks, or Weft's own key shapes (`scripts/secret-scan.mjs`) on each added line.
2. A docs-only commit stops here.
3. Unstaged imports (`scripts/staged-imports.mjs`): every relative or tsconfig-`paths` import in a staged code file has to
   resolve to a file in the index. One that resolves only to an untracked, not-ignored file on disk fails the commit,
   naming the file to `git add`. It takes about a second, and doesn't depend on tsc or its cache.
4. Types: `git checkout-index` into a temp folder, the tree's `tsconfig.tsbuildinfo` copied in for speed, `next typegen`, then
   `tsc --noEmit` through `scripts/one-at-a-time.mjs`.
5. Lint: eslint on the staged files.

On 2026-10-24, two commits imported files that were still untracked (5b3b845 → `lib/achievement-replay.ts`, 0d6ed7e →
`lib/changelog-open.ts`), and Vercel's build failed with "Module not found". Copying the incremental cache was the
suspect, but a scratch repro showed tsc 6 still reports TS2307 with the copied cache. The real cause: the tree's
`core.hooksPath` had been set to the absolute `.git/hooks`, which has no `pre-commit`, so the hook never ran. Step 3
names the missing file even when tsc would bury it, and the git guard keeps threads from unhooking the hook again.

Tests: `scripts/staged-imports.test.ts` (the import scan, alias and extension resolution, and the script against a real
temp repo).

## Route import guard

A missing module in a route file fails the whole route before React runs, and in Next's dev server every `/api`
route with it, so no `CrashGuard` sees it and `BuildErrorBar` (which keeps the last good build for files that don't
parse) can't help. The import guard's PostToolUse report comes too late for these files: the board is already down
(docs/bug-fixes/010). So `lib/route-import-guard.ts` denies the edit before it lands.

- **Which files**: relative to the project root (nearest `tsconfig.json` or `package.json`), `app/**/{page,layout,
  template,error,global-error,not-found,loading,default}.{tsx,ts,jsx,js}`, `app/**/route.{ts,js}`, and the root's
  `middleware`, `proxy` and `instrumentation`, with or without `src/`. Every other file gets only the PostToolUse report.
- **The file after the edit** (`contentAfter`): a Write's `content`; an Edit's or MultiEdit's `old_string` →
  `new_string` applied to the file on disk, in order (`replace_all` too). An edit that can't apply is let through:
  the tool fails on its own.
- **Only what the edit adds** (`addedImportProblems`): every `from "x"`, bare `import "x"` and `import("x")` in the new
  text that the old text didn't have. A local one (`./`, `../`, `@/`) must resolve through `resolveSpec()` in
  `lib/import-check.ts` (same extensions and `index` files); a package must be in a `node_modules` at or above the
  file. Builtins, `#` and `~` aliases are skipped, and packages too when there's no `node_modules` at all.
- **`@/` follows the project's tsconfig** (`lib/ts-paths.ts` `aliasBases()`): `compilerOptions.paths` against `baseUrl`
  (else the tsconfig's folder), a relative `extends` followed, the exact key or longest prefix winning as in TypeScript. DeckCP's
  `@/*` -> `./src/*` and Weft's `@/*` -> `./*` both resolve; with no mapping `@/x` tries the root, then `src/`. The reason's
  "write X first" names the first target. A tsconfig is parsed once per modification time (comments and trailing commas allowed).
- **The reason says what to do**: `"@/components/home/Home" doesn't exist yet: write components/home/Home.tsx first,
  then import it from app/page.tsx.` (the importer's extension when the import has none), or `install <pkg> first`.
- **Speed**: regexes and `stat`s on the added imports, no type-checker and no git; it only reads the edited file.
- **Outside Weft**: `scripts/import-check-hook.mjs` runs as both the PreToolUse and the PostToolUse hook in
  `.claude/settings.json`, branching on `hook_event_name`; a `registerHooks()` resolve hook lets Node's type
  stripping load `lib/` files that import their neighbours without `.ts`. It exits early in board threads, which get
  the in-process guard: `lib/weft-thread.ts` walks up from the hook's process to Weft's server (`WEFT_SERVER_PID`,
  set by `cliEnv()`), a few steps with no shell between. `CLAUDE_CODE_ENTRYPOINT=sdk-ts` can't tell, because a
  thread's Bash passes it on: a `puku-cli -p` a thread started used to skip every check (2026-10-16, a Board.tsx split
  that dropped `columnMinWidth` from its imports while still calling it, and the board threw on every reload).

## Prerender check (cacheComponents)

With `cacheComponents: true` in `next.config.ts`, `next build` refuses two things nothing else notices: `pnpm test`,
lint, typecheck and `next dev` all pass, and the Vercel build fails 14 minutes in. It happened three times: the admin
pages' `force-dynamic` (2026-10-16, f8aa47f), then `app/s/[id]/page.tsx`'s `force-dynamic` (88e1ff1) and its `await
params` before its `<Suspense>` (fcc13a8), both 2026-10-17. `lib/prerender-check.ts` finds both with the TypeScript
parser (comments and strings don't count):

- **Segment config** (`kind: "config"`, a certain build error): an exported `dynamic`, `revalidate`, `fetchCache` or
  `dynamicParams` in `app/**/page|layout` or `route.ts`, declared or `export { … }`-ed.
- **Runtime data before `<Suspense>`** (`kind: "blocking"`, a heuristic): `await params`, `await searchParams`
  (or `props.params`), `await cookies()` or `await headers()` at the top level of a page's or layout's default export
  (followed through `export default Name`), or of `generateMetadata`/`generateViewport`. Not flagged: awaits in
  nested functions or helpers it calls; `params` with `generateStaticParams` exported (ISR wants it there); params and
  searchParams in a `"use cache"` function; a default export already inside a boundary, from a `loading.tsx` beside the
  page or above, or a layout above that renders its `children` inside `<Suspense>` (`app/[orgSlug]/layout.tsx` covers
  its pages). Metadata functions are never covered. `connection()` isn't flagged: the admin pages await it at the top
  and build.
- **Clock before connection** (`facts.clock`): a page or layout function whose first call is `serviceClient()`, ahead of
  `connection()`, `webClient()` or `webUser()`, is flagged. supabase-js reads `Date.now()` as it builds a client, and on a
  cold lambda (the client is cached after) cacheComponents refuses it mid-prerender, even inside `<Suspense>` and after
  `cookies()`; only `connection()` moves past it (/invite/[token] on 2026-10-18; /login, /team, /[orgSlug]/* the same day).
  `webClient()` awaits `connection()` itself, so every `requireTeam`/`webUser` gate is covered.
- **Where it runs**: `lib/prerender-check.test.ts` walks the real tree (`treeProblems`) so `pnpm test` fails before a
  deploy; and the route import guard runs `prerenderCheck` on every Edit/MultiEdit/Write to a route file, only when the
  project's next.config turns cacheComponents on, and only for problems the edit adds: a segment config is denied, a
  blocking read comes back as `additionalContext` and the edit goes through. The parser loads lazily (`import()`), so
  only route-file edits pay for it. `scripts/import-check-hook.mjs` does the same outside Weft (exit 2, or the warning
  as JSON on stdout).

## Dropped-import check

`lib/dropped-imports.ts`, run after each Edit, MultiEdit or Write next to the import guard (in-process and in the hook).
An edit that trims an import while the file still uses the name compiles fine, so no build error shows; the board
then throws `X is not defined` when it draws. It rebuilds the file before the edit (undoing the Edit's or MultiEdit's
`new_string` → `old_string` on the text, or the last commit for a Write), takes the names the old imports bound and the
new ones don't, and reports each that the file still uses outside comments, strings, properties (`a.x`) and object
keys (`x:`), unless the file now declares it itself. Text only, like the import guard.


## Test runs (not a hook)

No hook stands between a thread and `vitest`; the guarding happens around the run instead. `pnpm test` takes turns
for whole-suite runs (`scripts/run-tests.mjs`), a worker whose run died ends itself (`lib/orphan-guard.ts`), a
stopped card's Bash commands end with its CLI (`lib/process-tree.ts`), and the server reaps leftover workers every
5 minutes (`lib/worker-reaper.ts`). See "Bash commands and orphaned test workers" in threads-and-sessions.md.

A whole-suite run is bounded on memory, because a sweep at the core count used to take Weft down with it (twice,
2026-10-21). Two guards, both on the whole-suite path only — a run of named files is short, scoped and untouched:
`scripts/test-memory.mjs` refuses to *start* one with under 2 GB genuinely free (`free + inactive + purgeable` less
swap in use), and `scripts/test-watchdog.mjs` ends the run if the vitest process tree's real RSS crosses 3072 MB
(`WEFT_TEST_MAX_RSS_MB`, `--no-watchdog` to bypass). The watcher attaches through `runHolding`'s `watchdog` option
in `scripts/one-at-a-time.mjs`, which already owned the spawn.

Vitest's own `vmMemoryLimit` is deliberately absent. It cannot do this job: on `pool: "forks"` `getMemoryLimit()`
returns `null`, a bare number parses as bytes rather than MB, and it only reads V8's `heapUsed` after each test
file finishes — so it is blind to RSC, native buffers and mmap'd graphs, and blind to a single runaway file mid-run.
`--max-old-space-size` stays as the per-worker JS-heap cap, which is all it ever was. See
`docs/bug-fixes/027-test-suite-memory-cap-was-a-noop.md`.

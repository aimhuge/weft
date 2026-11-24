# Antigravity

Antigravity CLI (`agy`) is Google's terminal coding agent, and since 18 June 2026 the CLI Google points individuals to
for Gemini: Gemini CLI's own README now says it is for Gemini Code Assist Standard and Enterprise only, has no free tier
or Google AI Pro/Ultra, and isn't tuned for Gemini 4. So Weft's Gemini backend is Antigravity, Weft's sixth CLI after
Claude Code, puku-cli, Codex, Goose and GitHub Copilot. Its id is `antigravity`; the thread shows it as **Antigravity**.

Install: `curl -fsSL https://antigravity.google/cli/install.sh | bash` (checks the download's sha512, puts the binary at
`~/.local/bin/agy`, and adds that folder to `~/.zshrc` and `~/.zprofile`). Homebrew's `antigravity` cask is the desktop
App, not the CLI. Weft finds `agy` on the app's PATH, or at `~/.local/bin/agy` when an app opened from the Dock doesn't
have that folder on its PATH (`lib/cli-path.ts`).

## Key files

| File | Role |
| --- | --- |
| `lib/acp-client.ts` | A small Agent Client Protocol client: JSON-RPC 2.0 lines over a CLI's stdin and stdout |
| `lib/antigravity-runner.ts` | The adapter: one warm `agy acp` per card; `startAgy`, `runAgyTurn`, `cancelAgy`, `closeAgy`, `answerPermission` |
| `lib/antigravity-events.ts` | One `session/update` into thread steps (text, tool start, tool end, context); the prompt's usage and stop reason |
| `lib/antigravity-tools.ts` | agy's tool names into Claude Code's (`run_command` → Bash, `read_file` → Read, `mcp_browser_open_url` → `mcp__browser__open_url`), for the thread and the guards alike |
| `lib/antigravity-prompt.ts` | Weft's instructions (`systemPrompt.append`), the prompt, the mode and model a card's settings map to |
| `lib/antigravity-mcp.ts` | Weft's tools for the session: one stdio relay per server in `session/new`'s `mcpServers` |
| `scripts/weft-mcp-relay.mjs` | That relay: stdin JSON-RPC lines posted to `/api/mcp/<server>` with the thread's bearer token |
| `lib/guards/antigravity.ts` | Weft's entry in `~/.gemini/config/hooks.json`, and the guards a card's agy runs behind |
| `lib/guards/antigravity-turns.ts` | Which conversation is which turn's guards, for the guard route |
| `lib/antigravity-login.ts` | Signed-in status from `agy -p /usage`, the sign-in kind, and the personal-account warning |
| `lib/cli-adapter.ts`, `lib/cli-messages.ts` | The shared adapter loop and thread rows every non-SDK CLI uses (docs/architecture/cli-adapters.md) |

## Why ACP and not `agy -p`

agy has two machine interfaces. The documented one is headless print mode: `agy -p "…" --output-format stream-json`
prints NDJSON (`init`, `step_update`*, `result`) and exits, and `--conversation <id>` resumes. The other is `agy acp`, an
Agent Client Protocol server that agy 1.5.16 ships but doesn't document. Weft uses ACP:

- **It stays warm.** One process per card, fed each turn as `session/prompt`, so a turn doesn't pay agy's startup. Print
  mode is one process per turn (its own warm mode, `--input-format stream-json`, can't be interrupted: a `control_request`
  ends the session).
- **A stop keeps the process.** `session/cancel` ends the turn (the prompt answers `stopReason: "cancelled"`) and the
  conversation goes on. `lib/runner.ts` `stop()` reaches it through `cancelTurn()`; a turn that doesn't end in time is
  ended like any other.
- **Weft's tools go per session.** `session/new` takes `mcpServers`, so nothing is written to agy's global
  `~/.gemini/config/mcp_config.json`.
- **Weft's instructions are a system prompt.** agy's `initialize` advertises an Antigravity extension,
  `_meta.antigravity.systemPrompt.append`, which `session/new` takes. Print mode has no `--system`.
- **Weft answers agy's permission questions.** `session/request_permission` comes to Weft, so the card's own permission
  mode decides, and an ask lands on the card the way Claude Code's do.

The cost: ACP is undocumented for agy, so it can change in an update. Everything below was measured against agy 1.5.16
on 24 November 2026.

## A session

```
start   agy acp                              env: cliEnv() + WEFT_GUARD_URL (no token)
        initialize {protocolVersion: 1}
        session/load {sessionId: card.sessionId, cwd, mcpServers}     a card with a conversation
          (its replayed history is ignored: it's already in the thread)
        or session/new {cwd, mcpServers, _meta.antigravity.systemPrompt.append}
        → sessionId kept on the card (card.sessionId), and bound to the card's guards
turn    session/set_mode, session/set_model  only when the card's mode or model changed
        session/prompt {prompt: [{type: "text", text}]}
          ← session/update …   thread rows as they come
          ← session/request_permission   answered by Weft
        → {stopReason, usage}  → the result row, with input, output (+ thinking), cache-read tokens
stop    session/cancel
close   stdin ends; agy exits 0
```

A conversation agy no longer has (`session/load` fails) starts a new one rather than failing the card. Antigravity keeps
no spare process (`ensureSpare`), because its guards are tied to a card; `warmUp` starts a card's process before its
first message instead. Weft doesn't make up a session id for it either: ACP names the conversation.

### What the thread shows

| `session/update` | Row |
| --- | --- |
| `agent_message_chunk` | Gathered into one assistant row, filed when a tool starts or the turn ends; each slice streams live as a delta |
| `tool_call` | A tool row, in Claude Code's tool names (`lib/antigravity-tools.ts`) |
| `tool_call_update` (`completed`, `failed`) | The row's result: the content's text, else `rawOutput`, else "Wrote <file>" for a diff. An edit's files go on the card's `touchedFiles` (inside its folder only) |
| `usage_update` | Nothing yet (it is how full the context window is) |
| `agent_thought_chunk`, `available_commands_update`, `session_info_update` | Nothing |

agy 1.5.16 over ACP calls its file tools `read_file` and `write_file` (`Path`, `Content`); its docs and print mode call
them `view_file` and `write_to_file` (`AbsolutePath`, `TargetFile`, `CodeContent`). Both are read. It names an MCP tool
`mcp_<server>_<tool>`, which becomes `mcp__<server>__<tool>`, the longest of Weft's server names first so `board_view`
isn't read as `board`.

### Images

A pasted image goes with its turn as an ACP image block (`{type: "image", mimeType, data}`, `agyPromptBlocks`), after
the text: agy's `initialize` says it takes them (`promptCapabilities.image`). Measured: a 16×16 red PNG came back as
"red".

## Permissions

The card's permission mode sets agy's mode (`lib/antigravity-prompt.ts` `agyMode`), and Weft answers what that mode
leaves to ask (`answerPermission`):

| Weft mode | agy mode | A permission request |
| --- | --- | --- |
| Ask (`default`) | `default` (asks before edits and commands) | Asked on the card (`lib/guards/ask.ts` `askAboutCall`) |
| Accept edits | `accept-edits` | Commands asked on the card |
| Auto | `auto` (agy's own classifier; needs its sandbox and a personal account) | What agy still asks, asked on the card |
| Bypass | `accept-edits` | Answered yes by Weft |

Weft's own tools (`mcp__*`) are answered yes in every mode; the ones that need you (a vault fill) ask through Weft
themselves. The guards below run before any of this.

## Guards

Every tool call a card's agy makes goes through Weft's guards first, reads included (the secret guard refuses `.env`
reads). The mechanism is agy's own `PreToolUse` hook (docs/architecture/thread-guards.md):

- agy reads hooks from `~/.gemini/config/hooks.json` and has no flag or env var for another config folder (`agy acp`'s
  `--gemini-dir` moves its credentials too). So Weft keeps **one entry, `weft-guards`**, in that shared file, merged in
  with yours left as they are, and written only when it changed. A file that isn't a JSON object is yours, maybe
  half-edited, and Weft won't overwrite it: the card fails with `GuardsUnavailable` instead.
- **The entry is inert outside Weft.** Its command acts only when agy's env has `WEFT_GUARD_URL`, which only a Weft
  thread's agy gets; anywhere else it answers `{"decision": "allow"}`, so your own agy sessions run as before.
- **No token in agy's env.** A hook inherits agy's env, and so would every command the model runs. So the hook carries no
  token: it posts the payload to `/api/guards/antigravity/PreToolUse`, and the route finds the turn from the payload's
  `conversationId`, which is the ACP session id the runner bound to the card's guards (`lib/guards/antigravity-turns.ts`).
- **Fails closed.** When Weft doesn't answer, the hook prints a refusal, as on Codex and Goose. A deny comes back as
  `{"decision": "deny", "reason"}`; the call fails with "tool call denied by pre-tool hook: <reason>" and the model reads it.
- **After a call, too.** agy's `PostToolUse` hook can only answer `{}`, but its `PreInvocation` hook, run before each
  model call, can inject steps. So the entry has three hooks: `PreToolUse` (the verdict), `PostToolUse` (Weft's
  after-call guards run, and what they have to say, a lint reminder or a refused write's reason, is kept for that
  conversation by `noteForModel`), and `PreInvocation` (`/api/guards/antigravity/PreInvocation` answers `takeNotes`: the
  kept notes as one `{"systemMessage": {"systemMessage": …}}` step, once). Measured on 1.5.16: a step that also carries
  the `metadata` the docs show was dropped, so Weft sends none. After-call and invocation hooks answer `{}` when Weft
  is down: there is nothing to refuse there.

## Weft's tools

`session/new`'s `mcpServers` takes stdio servers (agy 1.5.16's `initialize` names no HTTP support), so each of Weft's
servers (browser, board, secrets, webhooks, devservers, board_view, simulator, blastcp) is
`node scripts/weft-mcp-relay.mjs http://127.0.0.1:<PORT>/api/mcp/<server>`. The relay posts each JSON-RPC line to the
same stateless HTTP bridge Codex and Goose use (`lib/mcp-bridge.ts`). The bridge token goes in that relay's own env (ACP
passes a server's `env` to that server alone, measured), so it is never in agy's env. The node is the server's own
(`process.execPath`, with `ELECTRON_RUN_AS_NODE=1` for when that is Electron's binary).

## Signing in, and the terms

agy signs in with Google OAuth (`agy acp --login`, or an interactive `agy`), keeps the token in the macOS Keychain, and a
headless run reuses it. It can also run on a Gemini API key (`"modelProvider": "gemini"` in
`~/.gemini/antigravity-cli/settings.json` plus `GEMINI_API_KEY`), or on Google Cloud credentials (`AGY_ADC_AUTH=true`).

Google's Antigravity FAQ says: "Wrapping `agy` inside third-party coding agents or applications … is not supported under
consumer plans", and a neighbouring answer warns that third-party access with your login "can result in suspension or
termination of your account", recommending a Gemini Enterprise or AI Studio API key instead. A Google engineer on the
developer forum has said launching `agy` headless from a local orchestrator is supported; the FAQ says otherwise, and no
ruling has come. So Weft runs on any sign-in agy has, and its status line warns when it is a personal Google account
(`lib/antigravity-login.ts` `antigravityWarning`), naming the API key and Cloud routes.

Status is `agy -p /usage --output-format json`: free, and signed in it answers the account's quota as data
(`command.data.groups[].buckets[]` with `remaining_fraction` and `reset_time`); signed out, headless exits with an
`authentication required` error.

The same call feeds the plan-limits strip. `lib/antigravity-usage.ts` runs it on `lib/limit-poll.ts`'s 15-minute tick
(whatever the default CLI is; nothing when agy isn't installed or signed in), flattens the groups' buckets with
used = 1 − `remaining_fraction` (a `reset_time` of 1970 means the window hasn't started: no reset to show), and records
them under `antigravity` in `~/.weft/limits.jsonl`. The strip has one 5-hour and one weekly window per CLI, so each is the
tightest bucket of that length across the groups (Gemini's weekly, or Claude and GPT's weekly or 5-hour): the one that
runs out first is the one that stops a thread.

## Models

`MODELS.antigravity` in `lib/new-thread.ts` is a fixed list: "Antigravity's configured model" (agy's own choice, no
`session/set_model`) and Gemini slugs from agy's docs. A slug carries its thinking level (`gemini-3.8-flash-high`), so
Antigravity has no separate effort setting. What an account can use depends on its tier: a free account had Gemini 3.8
Flash (High, Medium, Low) plus Claude Sonnet 4.6, Claude Opus 4.6 and GPT-OSS 120B on a separate quota.

`session/new` and `session/load` answer with the account's real list (`models.availableModels`, `{ modelId, name }`).
The runner hands each answer to `rememberAgyModels()` (`lib/antigravity-models.ts`), which keeps it in
`~/.weft/antigravity-models.json` (its own file: it is what agy said, not a setting, and it rewrites only when the list
changes). `/api/settings` sends it as `antigravityModels`, `lib/use-named-models.ts` `useAgyModels()` reads it, and the
menus (`components/ModelSelect.tsx`, the thread header's `components/BackendPicker.tsx`) list
`lib/model-options.ts` `antigravityList()`: agy's own pick first, then the account's models; the fixed list until a
thread has asked. A new list shows on the board's next load.

Some of those ids carry other CLIs' names (`claude-sonnet-4-6`, `gpt-oss-120b-medium`), so a row for an id the fixed list
doesn't name hands back `agy:<id>` (`agyRowValue()`), as Goose's rows carry `goose:`. `backendFor`, `bareModel`,
`isModelValue` and `modelOn` in `lib/new-thread.ts` read the prefix; the card stores the bare id, which is what
`session/set_model` takes. On an Antigravity card `modelOn` keeps any id no other CLI's list names, so a card moved
there with a Claude Code model drops it, and the thread header's switch (`lib/host-api/card-cli.ts`) accepts an `agy:`
value or a remembered id.

## Still open

- A quota per model group: the strip shows the tightest bucket, not the one the card's model draws on.
- An MCP tool's output: agy 1.5.16 sends none in its `tool_call_update` (measured with Weft's relay), so the row for one
  of Weft's tools shows no result text, though the model gets it.
- Bug #1456 (agy 1.5.2, print mode): a turn that never sends its `result` while a `run_command` child waits on stdin.
  Under ACP a stop's `session/cancel`, then the stop's fallback abort, ends such a turn.

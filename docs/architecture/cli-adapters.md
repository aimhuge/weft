# CLI adapters

Claude Code and puku-cli run through the Agent SDK's `query()` (lib/runner-session.ts). Every other CLI Weft runs a
thread on is an **adapter**: Codex, Goose, GitHub Copilot and Antigravity. They speak different streams (Codex's `exec --json` items,
Goose's `stream-json` notifications, Antigravity's Agent Client Protocol), but each turn comes down to the same few
things, and those are shared. GitHub Copilot speaks its own SDK (`@github/copilot-sdk`), and is an adapter all the same.

## The interface

`lib/cli-adapter.ts`:

```ts
interface CliAdapter<State = void> {
  name: string;                                               // for errors the user reads
  start?(session): Promise<State>;                            // what lives across turns (a warm process)
  runTurn(session, message, state): Promise<void>;            // one turn, ending with a result row
  cancel?(session, state): void;                              // stop the turn, keep the process
  close?(session, state): Promise<void> | void;               // close what start opened
}
driveAdapter(session, adapter)   // the inbox loop every adapter shares
cancelTurn(session)              // lib/runner.ts stop(): true when the adapter could stop the turn itself
```

Three kinds fit it:

| Kind | CLIs | Implements |
| --- | --- | --- |
| One process per turn | Codex, Goose | `runTurn` (spawns, reads, waits for the exit) |
| One SDK runtime per turn | GitHub Copilot | `start` (its refusals), `runTurn`, `cancel` (the SDK's `session.abort()`) |
| Warm between turns | Antigravity (ACP) | `start`, `runTurn`, `cancel`, `close` |

`lib/runner-session.ts` `driveExternal()` hands a session to its adapter; nothing else in the runner knows which CLI it
is.

## What's shared

- **Thread rows** (`lib/cli-messages.ts`): `fileReply`, `fileToolStart`, `fileToolResult`, `fileResult` (with the turn's
  token usage) build the SDK messages `lib/runner-turn.ts` `handle()` already files, so a turn's rows, its result, its
  column and its stats work the same as Claude Code's. Each passes text through `scrub()`, which swaps any vault value
  the card used for `‹NAME›`. `noteTouched` puts the files a turn edited on the card for the overlap warning, inside the
  card's folder only. `keepSessionId` keeps the CLI's conversation id on the card, for the next start to resume.
- **The turn's process** (`lib/cli-turn.ts`, the per-turn adapters): spawning with `spawnCli`, NDJSON lines that skip
  noise, and the "exited without finishing the turn" error with the stderr tail.
- **The loop** (`driveAdapter`): one message at a time, a turn's tool index cleared before it, the adapter closed when
  the inbox ends or the session is aborted.

## Adding a CLI

1. The backend's id in `Backend` (packages/weft-client/src/card.ts) and the lists docs/architecture/goose.md
   "The one list of CLIs" names; TypeScript flags every `Record<Backend, …>`.
2. An adapter: its argv or protocol, its events into `lib/cli-messages.ts` calls, a `*_CODE` array for the build
   fingerprint, and a branch in `driveExternal()`.
3. Its guards (docs/architecture/thread-guards.md): the CLI's own pre-tool hook posting to `/api/guards/<cli>/<event>`,
   a call mapper in `lib/guards/calls.ts`, its answer shape in `lib/guards/answer.ts`. A CLI without a hook Weft can
   install doesn't get a backend: every thread runs behind the guards.
4. Weft's tools: the HTTP bridge (`lib/mcp-bridge.ts`) as the CLI takes MCP servers (flags for Codex, a config file for
   Goose, ACP's `mcpServers` with a stdio relay for Antigravity).
5. Login status and sign-in (`lib/login-status.ts`, `lib/login-terminal.ts`).

An ACP agent that isn't Antigravity can reuse `lib/acp-client.ts` as it is: it knows JSON-RPC and nothing about agy.

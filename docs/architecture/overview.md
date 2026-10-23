# Weft architecture overview

A desktop board where each card is a long-lived AI coding CLI thread. The Electron shell
hosts a Next.js server, which runs each thread through the Claude Agent SDK as a streaming
`query()` over a per-card CLI process. State is one JSON file on disk; the UI stays live
through a server-sent events stream.

## Layers

```
Electron shell (electron/*.cjs)
  └── Next.js server (app/* via next dev / next start / standalone)
        ├── app/api/*           REST endpoints, all behind lib/guard.ts
        ├── app/api/events      SSE: lib/bus.ts -> connected boards
        ├── lib/runner*.ts      per-card Inbox -> query() -> CLI subprocess (api in runner.ts)
        ├── lib/store.ts        board.json + threads/<id>.json in ~/.weft
        ├── lib/settings.ts     settings.json + projects
        ├── lib/login.ts        <cli> auth login as a managed subprocess
        ├── lib/import.ts       picks up ~/.claude/projects as cards
        └── lib/copilot.ts      prewarm + ensureCopilot
```

## Key files

- `electron/main.cjs` — windows, menus, tray, dock badge, weft:// links, single-instance
  lock, the `Control+Alt+Space` global shortcut, and the splash screen.
- `electron/server.cjs` — supervises the Next.js server in dev / start / packaged-standalone
  modes, restarts on crash, writes to `~/Library/Logs/Weft/server.log`.
- `electron/browser-pane.cjs` — native `WebContentsView` pane + a token-protected HTTP
  control server on `127.0.0.1` that `lib/browser-tools.ts` calls.
- `electron/preload.cjs` — the `window.weft` bridge (typed in `lib/client.ts`).
- `lib/runner.ts` (+ `runner-state`, `runner-session`, `runner-turn`, `runner-ask`) — one CLI process per card,
  the `Inbox` of `SDKUserMessage`s, warm sessions, spares, permission routing, BOARD STATUS handling, auto-login.
- `lib/store.ts` — board + thread persistence; legacy `~/.threadboard` is moved to
  `~/.weft` on first start; cards that were `running` at load become `review`.
- `lib/settings.ts` — `DEFAULT_THREAD_PROMPT`, `keepAliveMinutes`, project list,
  `dismissedSessions`.
- `lib/guard.ts` — `Host` must be `127.0.0.1 | localhost | [::1]`; writes also need
  `x-weft-token: 1`.
- `lib/bus.ts` — single `EventEmitter` on `globalThis` (survives dev-mode HMR); consumed
  by the SSE route.
- `lib/types.ts` — `Card`, `ThreadItem`, `Question`, `Backend`, `BoardEvent` union.
- `components/Board.tsx` — the board UI: it owns the state and wires the layers, while hooks under `lib/`
  decide (`lib/board-live.ts` stays live off `useBoardEvents`) and components draw (`BoardHeader`,
  `BoardProjectBar`, `BoardColumns`, `OpenCard`, `BoardBottom`, `BoardDialogs`; docs/architecture/board.md),
  with `CardView`, `ThreadPanel`, `BrowserPane` and `ColumnHeader` underneath (Running/Needs you get "Switch all", Review gets "Review all"
  — the commit walk-through card — plus "Resume N" for cut-off turns, Done gets archive controls).

## Data flow

1. The shell starts the Next server (`electron/server.cjs`), passes
   `WEFT_SHELL_URL` and `WEFT_SHELL_TOKEN` so threads can reach the browser
   pane, and loads the board URL into a `WebContentsView` (`appView`).
2. `GET /api/cards` triggers `prewarm()` (`lib/copilot.ts`): it ensures the copilot
   card, opens its CLI, starts a spare in the most recent project, and kicks off
   `startSessionSync()` so existing Claude Code sessions show up as cards.
3. The board opens an `EventSource("/api/events")`. Every `lib/store.ts` and
   `lib/runner.ts` mutation calls `publish()` on `lib/bus.ts`, which the SSE route
   forwards.
4. Replying to a card hits `POST /api/cards/[id]/messages`, which calls
   `sendMessage()` in `lib/runner.ts`. `Inbox.push()` wakes the SDK query loop, which
   streams `SDKMessage`s back; `handle()` (`lib/runner-turn.ts`) writes thread items and updates the card.
5. Tools that need approval reach the card through `askUser` → `settle` →
   `answerPermission` (the card shows the questions from `AskUserQuestion` in
   `QuestionForm`).
6. Each turn ends with the agent's `BOARD STATUS:` line, parsed in `lib/status.ts` and
   applied to the card (`column`, `stage`, `remaining`).
7. The board sends the number of cards in `needs_you` to the shell (`setBadge`), which
   updates the dock badge and the menu bar item (`updateTray`).

## Important patterns

- **GlobalThis as module memory.** `runner`, `store`, `bus`, `login`, `import`, and the
  prewarm flag all stash long-lived state on `globalThis` so Next.js dev-mode HMR doesn't
  fork them into two copies.
- **Inbox + AsyncIterable.** `Inbox` is a tiny queue that turns `push()` calls into the
  `AsyncIterable<SDKUserMessage>` the SDK's `query()` consumes, so one CLI process
  serves many user messages back-to-back.
- **BUILD fingerprint.** `runner-session.ts` derives a SHA-1 of the drive, turn-handler, askUser and settle
  functions and replaces idle sessions whose `build` no longer matches, so dev-mode code
  reloads don't leave idle CLIs running old code.
- **Warm sessions and spares.** `warmUp` keeps a card's CLI open between turns;
  `ensureSpare` keeps up to three project-folder spares so a new card adopts one
  instantly instead of waiting 12–50s for a cold CLI start.
- **Guard at the edge.** Every API route begins with `guard(req)`, which checks the `Host`
  header. Writes also need `x-weft-token: 1`; reads (GET routes and the SSE stream) skip that
  with `guard(req, { write: false })`, since `EventSource` can't set custom headers.
- **SDK session marking.** `lib/env.ts` strips `CLAUDECODE` / `CLAUDE_CODE_*` /
  `CLAUDE_AGENT_SDK_*` / `CLAUDE_PID` / `CLAUDE_EFFORT` / `CLAUDE_PREVIEW_*` and sets
  `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, so threads Weft starts don't appear in the Claude
  app's session list or pick up another session's socket.
- **Data folder override.** The `WEFT_DATA` env var (read in `lib/store.ts`, which
  `lib/settings.ts` follows, and in `electron/main.cjs` for the Help menu's "Open Data
  Folder") redirects everything; otherwise `~/.weft` is used.

# Error boundaries

Threads edit Weft's own source while Weft runs in dev mode, so the board regularly meets a half-written file: a JSX
tag before its import, a renamed prop, a constant that references a component not imported yet. The boundaries keep
each failure in the smallest spot that owns it, with the error shown and a way to try again once the edit lands.

## Layers, outermost first

| Boundary | Catches | Shows |
| --- | --- | --- |
| `app/global-error.tsx` | the root layout | a bare page with Try again and Reload |
| `app/error.tsx` | `Board.tsx` itself, or a static import of it | on the desktop, "The board failed to draw"; hides the browser pane while it shows (the pane is a native view over the window) and restores it after. On weft.zip (`lib/local-board.ts`), the web page "This page didn't load" ([web-states.md](web-states.md)) |
| `guarded()` pieces | a component that throws as it draws **or as its module loads** | the CrashGuard fallback in that piece's spot |
| `CrashGuard` wrappers | a component that throws as it draws | a box, or with `inline` a one-line chip |

## Key files

- `components/CrashGuard.tsx`: the boundary (`catchError` from `next/error`). Props: `what` ("card", "reply box"),
  `name` (which one), `className`, `inline` (a chip with the error in a `Tip` on hover; click retries), `onClose`
  (adds Close beside Try again).
- `components/guarded.tsx`: `guarded(() => import("./X"), { what, inline?, className?, placeholder? })` returns a
  component that loads `X` with `import()` inside a CrashGuard. It takes the loaded component's props plus
  `guardName`, and passes the component's own `onClose` to the fallback.
- `components/Modal.tsx`: every dialog's body sits in a CrashGuard under its header, so ✕ and Escape still work.

## Why `guarded()` exists

A CrashGuard only catches errors thrown while React renders. A module that throws while it *evaluates* (for example
`const TOOLS = { blastcp: [<BlastcpLogo />, …] }` written before `import BlastcpLogo`) fails every module that statically
imports it, up the chain to `Board.tsx`, and only `app/error.tsx` is left to catch it. Loading the piece with
`import()` turns that into a rejected promise. `guarded()` stores it and throws it while rendering, where the piece's own
CrashGuard catches it.

How it loads:
- The import starts when the module that calls `guarded()` evaluates (browser only), so the piece is usually ready by
  the time it's first drawn.
- Its state is read with `useSyncExternalStore`, with a server snapshot of `null`, so SSR and hydration draw the
  placeholder and later mounts draw the component on their first render, with no flash on opening a thread or dialog.
- A failed load forgets its promise, so Try again (which remounts) calls `import()` again.

## Where it's used

- `Board.tsx`: AccountButton, CopilotButton, HeaderBadges, LibraryRail, CardView, NewCardDialog and BoardDialogs
  (every dialog: Settings, Shortcuts, Tags, Login, CommandPalette, plus ModifierHint). ProjectBar stays a static import
  (Board uses its `folderName`) inside `BoardProjectBar`'s plain CrashGuard.
- `OpenCard.tsx`: ThreadPanel, EditorColumn, BrowserPane, ShowRail, CardWorkspace, PaneCardMarks.
  `BoardBottom.tsx`: BoardFooter, TerminalDrawer. `BoardBrowserPane.tsx`: BrowserPane, ShowRail.
- `HeaderBadges.tsx`: each badge (quality, pile, backlog, streak), inline.
- `ThreadPanel.tsx`: ReviewPanel. `ThreadView.tsx`: ReplyBox.
- Plain CrashGuards: each thread message and tool run and the streaming reply (`ThreadItems.tsx`, inline); the
  permission request (`ThreadView.tsx`); mode picker, skill menu and ☆ (`ThreadPanel.tsx`, inline); each library drawer's
  body (`LibraryRail.tsx`); the copilot window's conversation (`CopilotChat.tsx`).

## Patterns

- Use `guarded()` for a sizeable piece a thread is likely to edit; a plain CrashGuard is enough for a piece whose
  module is stable but whose data can be odd (a message's Markdown).
- Keep a type-only import (`import type { PaletteItem }`) when the parent needs the module's types; a value import
  brings the static failure back.
- Never build JSX in a module-level constant when a function or a component would do; it moves render work to load time.
- Tests: `components/guarded.test.tsx` (load, preload, failed load caught and retried, Close, placeholder) and
  `components/crash-guards.test.tsx` (inline chip, Modal, one broken message).

## Build errors

A file that doesn't parse fails the route before React runs, so no boundary sees it. `lib/build-error.ts` reads Next's
Build Error overlay (dev mode only, polled once a second), hides it, and `components/BuildErrorBar.tsx` draws a small bar
instead: the file that broke, **Details** for the message, and **×** to dismiss. A dismissal holds for that error only
(same file and message); a different build error brings the bar back. Test: `components/BuildErrorBar.test.tsx`.

## Which card broke Weft

Every card runs inside Weft's one Next server, so a thread can take the board down for everyone, and all the user
sees is Weft restarting. On 2026-10-23 one card's `mcp__devservers__start pnpm dev` restarted it seven times in half
an hour: Weft's `dev` script frees port 1024 first, which is the board's own server. The card that does it now gets
marked: a red ring and a **💥 Broke Weft** chip (×N when it does it again) whose hover says what it did, with × to
dismiss (`PATCH /api/cards/:id { broke: null }`); the thread hears why ahead of its next message, once.

Three things get reported, each with its time:

| Breakage | Who reports it | Evidence that blames a card |
|---|---|---|
| The server stopped without Weft asking | `electron/server.cjs` → `electron/server-exit.cjs` writes `~/.weft/server-exit.json`; the next server reads it once in `prewarm()` (`consumeServerExit`) | a Bash or devservers command in the 15 s before it that `restartTarget` (`lib/restart-guard.ts`) says stops Weft |
| A build error | `BuildErrorBar` → `lib/use-break-report.ts` → `POST /api/broke` with the overlay's file | the latest edit to that file in the last 30 min |
| A full reload of the board | the same hook, from `performance` (`reload`) and the time the page left (`pagehide`) | a command that stops Weft in the 8 s before it |

`lib/crash-blame.ts` weighs each card's recent thread items (a command that stops Weft beats an edit to the broken
file; latest of equals), marks `Card.broke`, and folds the board's reload after a server stop into that same incident.
It never blames an edit for a reload just for being nearby: the first version did, and marked a card for a reload that
Next's log put on its own `app-bootstrap.js` (every full reload logged on 2026-10-23/24 was that). Next does name the
module it reloaded for ("Fast Refresh had to perform a full reload when ./x changed" in the server log); matching a
card's edit against that line is the evidence a Fast Refresh reload still needs, and isn't built. When nothing on the board explains it (you pressed ⌘R, something outside Weft
sent the SIGTERM), nobody is marked. A command a guard refused can't be blamed. Reloads and build errors are reported in
dev mode only. Tests: `lib/crash-blame.test.ts`, `lib/use-break-report.test.ts`, `electron/server-exit.test.ts`,
`app/api/broke-route.test.ts`.

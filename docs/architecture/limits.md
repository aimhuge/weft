# Limits and the start gate

A thread can meet a limit in three places, and each has its own store:

| Limit | Store | Read by |
|---|---|---|
| The model's own cap (Opus runs out before the CLI's window does) | `~/.weft/model-limits.json` | `lib/model-limit.ts` |
| The CLI's weekly window | `~/.weft/limits.jsonl` | `lib/limit-history.ts` |
| The CLI's 5-hour window | the same plan log, plus the card's own snapshot `card.stats.fiveHour` | `lib/limit-history.ts`, `lib/store.ts` |

`lib/limit-reset.ts` reconciles them. It is the one answer to "when does this reset?", and it is
pure: the stores come in as data, so the server and the browser run the same code and always
agree.

## The pattern

**One pure module, fed by data.** `lib/limit-reset.ts` never touches the disk. Its inputs are the
plan samples (`PlanSample[]`), the model's own limits (`ModelLimitView[]`), the card's own snapshot
(`LimitWindow`) and `now`. That is what lets a client file use it: the browser can't read
`~/.weft`, so the numbers arrive over `/api/limits/plans` and go into the same functions.

**The server decides; the client labels.** `lib/start-gate.ts` (`startGate(backend, model, now)`)
reads the stores off disk and is the answer that matters. `lib/use-start-gate.ts` reads the same
numbers from `/api/limits/plans` and only draws the label ("Start at 2:30am"). A stale label can
be wrong for a minute; the server's answer cannot.

**The tightest limit wins.** The model's own cap comes first (it is the tighter limit, and the one
the user picked), then the CLI's weekly window (the one that blocks for days), then its 5-hour
window.

**A limit with no known reset has no answer.** The module returns `undefined` for it, and the
caller falls back to "wait an hour" rather than pretending to know.

## Key files

- `lib/limit-reset.ts` (new) — the pure module.
  - `planWindow(samples, backend, kind, now)` → the newest reading of one CLI's window; `undefined`
    once its reset has passed (the window is full again and the next one isn't known yet).
  - `modelResetsAt(model, limits, now)` → when this model's own cap frees up (unix ms).
  - `resetFor(backend, model, samples, limits, now)` → `ResetAnswer | undefined` for a thread that
    would run on that model and CLI: `{ at, kind: "five_hour" | "seven_day" | "model", subject }`.
  - `threadReset(window, planReset, backend, model, samples, limits, now)` → the same, with a
    running thread's own snapshot in front of the shared stores.
  - `limitNote(model, limits, now)` → "limit until 2:30am" (the picker's line is
    `lib/model-fallback.ts`'s own `limitNote`, which reads the store directly).
  - `gateNote(gate, modelLabel?)` → "5-hour limit used up" / "weekly limit used up" /
    "<model> hit its limit".
  - Types: `ResetAnswer`, `PlanSample`, `ModelLimitView`.
- `lib/start-gate.ts` (new) — `startGate(backend, model, now)`: the server's answer. It reads
  `readSamples(now)` (`lib/limit-history.ts`) and `modelLimits(now)` (`lib/model-limit.ts`) and calls
  `resetFor`.
- `lib/use-start-gate.ts` (new) — the browser's label.
  - `useStartGate(backend, model)` → the reset a new thread would wait for.
  - `useThreadGate(window, planReset, backend, model)` → the reset a running thread would wait for.
  - `loadGates()` / `resetGates()`; the numbers are cached, shared by every subscriber, and read
    again every `GATE_POLL_MS` = 60 s.
- `lib/new-card.ts` — `startCard(card)` gates and schedules (see below).
- `lib/reply-mode.ts` — `ReplyBoxState` gained `limitResetAt`; `replyBoxMode` prefers it over the
  card's own 5-hour window.
- `lib/use-plan-limits.ts` — `useLimitedModels()` (and the `LimitedModel` type) for the model
  pickers; the same route ships the models that have hit their own cap.
- `app/api/cards/route.ts` — `POST` returns the `start` answer: `{ started, at }`.
- `app/api/limits/plans/route.ts` — `GET` returns `{ plans, models }`: each CLI's newest window
  reading and the models at their cap.
- `components/NewCardDialog.tsx`, `components/NewCardDialogFooter.tsx` — the button's label and the
  warn-coloured status line.
- `components/ReplyBox.tsx`, `components/ThreadFooter.tsx` — the thread's own gate.
- `components/ModelSelect.tsx` — a used-up model reads "— at its limit".

The stores themselves are documented in `docs/architecture/limits-burndown.md` (the plan log, the
chart, the status strip) and in `lib/model-limit.ts` (the per-model store, written when a turn
comes back with a limit error, `lib/rate-limit.ts`).

## The new-thread path

A thread started on a spent model fails on its first turn and lands in Needs you, dead. Weft knows
before the turn starts, so the New thread dialog asks first:

- **The label.** `useStartGate(dialog.backend, dialog.model)` gives the reset. The Start button
  reads **Start at 2:30am** (`components/NewCardDialogFooter.tsx`), and the status line says which
  limit is used up (`gateNote`), in warn colour.
- **The decision.** `POST /api/cards` calls `startCard(card)` (`lib/new-card.ts`):

```ts
export function startCard(card: Card): { started: boolean; at?: number } {
  const gate = startGate(card.backend, card.model);
  if (gate) {
    scheduleMessage(card.id, firstMessage(card), gate.at);
    return { started: false, at: gate.at };
  }
  sendMessage(card.id, firstMessage(card));
  return { started: true };
}
```

A card whose model or CLI is at its limit doesn't get its first turn now: its first message is
scheduled for the reset, and the scheduler (`lib/scheduler.ts`, a 15 s tick) sends it the moment
the window opens. A card that never ran is fine to schedule — the runner opens a session for it
then (`lib/runner.ts`).

The route's answer is the truth the client drew: `{ started, at }`.

## The reply box's gate

The reply box reads the same gate, so a model's own cap and the CLI's weekly window reach it too
— it used to know only the 5-hour window.

`components/ReplyBox.tsx` calls `useThreadGate(fiveHour, sendLater?.resets.fiveHour, backend,
model)` and passes the result as `limitResetAt` into `replyBoxMode`. `replyBoxMode` prefers
`limitResetAt` over the card's own snapshot (`s.limitResetAt ?? limitResetAt(s.fiveHour,
s.sendLater?.planReset, s.now)`), so the shared stores win where they know more.

`threadReset` is the ordering that makes that right: the card's own snapshot is the freshest
number it has (it saw the window fill up in this very conversation), so it wins when it says the
window is spent — but the model's own cap is answered first, and the weekly window is filled in
from the plan log.

The mode table and the rest of the reply box are in `docs/architecture/composer.md`.

## Important patterns

- **Pure, and fed by data.** Anything that needs the disk reads it in one server module
  (`lib/start-gate.ts`); the shared logic is a function of its arguments.
- **One answer, two readers.** The server and the browser must not disagree about when a window
  opens, so both run `lib/limit-reset.ts` — never a second implementation of the same rule.
- **The client labels, the server decides.** A button that says "Start at 2:30am" is a promise; the
  server's gate is the promise's keeper.
- **A card that never ran is schedulable.** The scheduler sends a message to a card with no
  session; the runner opens one.

## Not built yet

- **The web board (weft.zip)** can't schedule: the cloud command kinds are `new_card`, `reply`,
  `answer` and `stop`, with no `schedule` (`lib/cloud-commands.ts`). A `schedule` kind, the way
  `reply` works, is what's missing.
- **The copilot** can't be scheduled either: `scheduleMessage` refuses the copilot
  (`lib/scheduler.ts`). It falls back to the backup model when its own model is spent
  (`lib/copilot.ts`).
- **Codex** has no plan limit to read (`lib/limit-poll.ts`), so it never gates.

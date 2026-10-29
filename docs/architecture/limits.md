# Limits and the start gate

A thread can meet a limit in three places, and each has its own store:

| Limit | Store | Read by |
|---|---|---|
| The model's own cap (Opus runs out before the plan's window does) | `~/.weft/model-limits.json` | `lib/model-limit.ts` |
| The CLI's weekly window | `~/.weft/limits.jsonl` | `lib/limit-history.ts` |
| The CLI's 5-hour window | the same plan log, plus the card's own snapshot `card.stats.fiveHour` | `lib/limit-history.ts`, `lib/store.ts` |

**Each CLI has its own plan** (`lib/plan-pools.ts`). Claude Code runs on Anthropic's subscription and
reads the claude.ai account's windows (the SDK's `rate_limits` come from the claude.ai usage endpoint,
`sdk.d.ts:4293`); puku-cli bills through Puku's gateway (`lib/puku-proxy.ts`) and has no Anthropic
plan limit; Codex is on OpenAI's. So the plan limits are read per **CLI**: a sample's `backend` is the
CLI whose session read it, and that window answers only for that CLI — a puku thread is not gated by
Claude Code's spent 5-hour window. The model's cap is per model.

**Which limit a hit is, decides which store it goes in.** The SDK names the window it refused on
(`sdk.d.ts:5680`): `five_hour` and `seven_day` are the *plan's*, and `seven_day_opus` /
`seven_day_sonnet` are one *model's* own weekly cap. `lib/limit-kind.ts` reads that name:

- a plan window goes to the plan log (`lib/limit-history.ts`), and gates every model on that plan;
- a per-model cap goes to the per-model store (`lib/model-limit.ts`), and gates that model alone.

Filing a per-model cap as a plan window is what left a user staring at "at its limit" with no way
out: the cap was on Opus, but it was held against the plan, so picking Sonnet in the composer
changed nothing. `lib/limit-kind.ts` also reads the per-model windows the SDK's usage answer
carries (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`), so a cap is known before it
refuses a request.

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

**Both readers see one window per CLI.** The server reads the raw log, where a CLI has one reading
per window. The client reads the `/api/limits/plans` payload, where each CLI carries its own windows,
so `samplesOf()` reduces it to one sample per CLI per window before `planWindow()` sees it. Read as two
readings of one counter, the newer of the pair would win over the one the server saw — and the two
would disagree about when the window opens.

**The tightest limit wins.** The model's own cap comes first (it is the tighter limit, and the one
the user picked), then the plan's weekly window (the one that blocks for days), then its 5-hour
window.

**A limit with no known reset has no answer.** The module returns `undefined` for it, and the
caller falls back to "wait an hour" rather than pretending to know.

## Key files

- `lib/limit-kind.ts` — which limit a hit is: the plan's own window, or one model's own cap.
  - `planWindowOf(rateLimitType)` → `"five_hour" | "seven_day" | undefined`: the account's windows.
  - `modelFamilyOf(rateLimitType)` → `"opus" | "sonnet" | undefined`: the family a per-model cap is for.
  - `modelCapFor(cardModel, rateLimitType)` → the model id a cap is recorded under, when the card's
    own model is the one the cap names.
  - `recordModelCaps(model, limits, now)` → records the per-model weekly caps the SDK's usage answer
    carries (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`) against that model.
  - `PlanRateLimits` — the SDK's rate-limit windows, spelled out so the SDK's shape is depended on
    in one place.
- `lib/limit-upgrade.ts` — noticing that the user raised their plan (see below).
  - `releasedModels(limits, now)` → the models Weft holds a cap on whose family the CLI now reports
    with room, on a window that is still open.
  - `releaseUpgradedModels(limits, now)` → forgets those caps (`clearModelLimit`), and says which
    models it freed.
- `lib/limit-reset.ts` (new) — the pure module.
  - `planWindow(samples, backend, kind, now)` → the newest reading of one window by THAT CLI
    (`lib/plan-pools.ts`), since each CLI has its own plan; `undefined` once its reset has
    passed (the window is full again and the next one isn't known yet).
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
- `app/api/limits/plans/route.ts` — `GET` returns `{ plans, models }`: one entry per CLI that has
  reported, carrying that CLI's own newest window readings, and the models at their cap.
- `lib/plan-pools.ts` — which CLIs read one plan's counter: `poolOf()`, `samePool()`, `poolKey()`.
  Every CLI has its own plan, so each is its own pool.
- `components/NewCardDialog.tsx`, `components/NewCardDialogFooter.tsx` — the button's label and the
  warn-coloured status line.
- `components/ReplyBox.tsx`, `components/ThreadFooter.tsx` — the thread's own gate.
- `components/ModelSelect.tsx` — a used-up model reads "— at its limit".

The stores themselves are documented in `docs/architecture/limits-burndown.md` (the plan log, the
chart, the status strip) and in `lib/model-limit.ts` (the per-model store, written when a turn
comes back with a limit error, `lib/rate-limit.ts`).

## The upgrade path

A user who upgrades their plan does not wait for a window to reset — the limits simply stop
applying. Weft has to notice that, or the upgrade looks like it did nothing.

There are two stores, and only one of them was watching.

**The plan log** (`lib/limit-history.ts`) watches the plan's own windows and fires `onReset` when a
window drops from 100% to below it. An upgrade usually moves those numbers too, so a plan whose
utilization falls resumes its parked cards through that path.

**The per-model store** (`lib/model-limit.ts`) did not watch anything. A cap recorded there — "Opus
ran out, until Tuesday" — was only ever cleared by its own window passing. Nothing cleared it when
the PLAN changed, so after an upgrade Weft carried on calling Opus spent: the model picker said "—
at its limit", the New thread dialog said "Start at 2:30am", and a card parked on Opus stayed
parked. `clearModelLimit()` existed; nothing called it.

`lib/limit-upgrade.ts` is the join. It reads the CLI's own answer — which carries the per-model
weekly windows (`seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`) — and compares it with the
caps Weft holds. A cap is released when **both** are true:

- the CLI reports a weekly window for that model's family, and that window has room
  (`utilization < 100`);
- the window it names is still open — its reset has not already passed (`resetsAt * 1000 > now`).
  A window that already reset says nothing about the cap, because the reading may be about a
  different window than the one that capped it.

The family is matched the same way `lib/limit-kind.ts` matches it: the SDK names "opus", Weft
stores "claude-opus-5-5" — so the stored id contains the family the SDK names.

Two callers:

- **The poll** (`lib/limit-poll.ts`), every 15 minutes: `recordLimits()` first (which is where the
  plan-window *reset* path fires), then `releaseUpgradedModels()` frees the stale caps, then
  `resumeParkedOnModels()` wakes the cards parked on those models.
- **A card's own turn** (`lib/runner-turn.ts`), at the CLI's `init`: release the caps, so a thread
  that starts after the upgrade is not gated by a stale one. This path frees the cap but does not
  wake parked cards — only the poll does that.

The card says why it restarted: `card.autoResumedReason` is `"upgrade"` (the chip reads "Resumed ·
plan upgraded") or `"reset"` (the chip reads "Auto-resumed · 2:30pm"). `lib/limit-resume.ts` sets
it as it replays the last user message.

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

The reply box reads the same gate, so a model's own cap and the plan's weekly window reach it too
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

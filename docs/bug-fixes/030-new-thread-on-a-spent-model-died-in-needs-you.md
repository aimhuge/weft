# 030 — a new thread on a spent model failed on its first turn and died in Needs you

**Date:** 2026-10-24 · **Severity:** Medium (not a crash: the card was created, its first turn came straight back as a rate-limit error, and the card sat in Needs you with nothing to run)

## Symptom

A thread started on a model whose plan window was already used up never ran. The New thread dialog's Start
button read "Start now" whatever the model had left; the card was created, its first turn came back as a
rate-limit error, and the card landed in **Needs you**, dead. The user waited for a thread that could never run.

The same limit, met by a thread that was already running, was handled: the reply box offered "Send at 10:39pm".
The new-thread path knew nothing.

## Root cause

`lib/new-card.ts`'s only pre-start guard was `fallbackFor(model)` (`lib/model-fallback.ts`): "was this model
recorded as exhausted, and is there a backup model to move to?". It is a *fallback* rule, not a *gate* — with no
backup model set it returns `undefined`, so the card started on the spent model anyway.

```ts
// before — lib/new-card.ts
const fallback = fallbackFor(model);
const startBackend = fallback?.backend ?? backend;
const startModel = fallback?.model ?? model;
// ... the card is created, and its first message goes straight out:
sendMessage(card.id, firstMessage(card));
```

Nothing asked "is the plan window full?". The card's first turn was the first thing that found out, and by then
the only recovery left was the rate-limit banner.

## Fix

One gate, shared by every surface a thread can meet a limit, in a pure module fed by data:
`lib/limit-reset.ts` (`resetFor`, `threadReset`, `modelResetsAt`, `planWindow`, `limitNote`, `gateNote`).
The tightest limit wins: the model's own cap, then the CLI's weekly window, then its 5-hour window.

The server decides (`lib/start-gate.ts` `startGate(backend, model, now)`, reading `~/.weft/limits.jsonl` and
`~/.weft/model-limits.json` off disk); the browser only labels the button (`lib/use-start-gate.ts`, over
`/api/limits/plans`).

```ts
// after — lib/new-card.ts
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

The card's first message is scheduled for the moment the window opens, and the scheduler sends it then. A card
that never ran is fine to schedule — the runner opens a session for it when the time comes.

The New thread dialog now asks first: the Start button reads **Start at 2:30am**
(`components/NewCardDialogFooter.tsx`) and the status line says which limit is used up (`gateNote`). The reply box
reads the same gate (`lib/reply-mode.ts`'s `limitResetAt`, fed by `components/ReplyBox.tsx` and
`components/ThreadFooter.tsx`), so a model's own cap and the weekly limit reach it too.

**Key rule:** before a thread's first turn, ask the shared gate whether the model or the CLI is at its limit — a
limit with no known reset has no answer, and the caller waits rather than guessing.

## Files

- `lib/limit-reset.ts` (new) — the pure gate: `planWindow`, `modelResetsAt`, `resetFor`, `threadReset`,
  `limitNote`, `gateNote`; types `ResetAnswer`, `PlanSample`, `ModelLimitView` (and `LimitWindow`,
  which comes from `lib/types`)
- `lib/limit-reset.test.ts` (new) — the gate's rules
- `lib/start-gate.ts` (new) — `startGate(backend, model, now)`, the server's answer
- `lib/start-gate.test.ts` (new)
- `lib/use-start-gate.ts` (new) — `useStartGate`, `useThreadGate`, `loadGates`, `resetGates`
- `lib/use-start-gate.test.ts` (new)
- `lib/new-card.ts` — `startCard` gates and schedules
- `lib/new-card.test.ts` — the gated and the ungated start
- `lib/reply-mode.ts` — `ReplyBoxState` gained `limitResetAt`; `replyBoxMode` prefers it
- `lib/use-plan-limits.ts` — `limitedModels`, `useLimitedModels`
- `app/api/cards/route.ts` — `POST` returns the `start` answer (`{ started, at }`)
- `app/api/limits/plans/route.ts` — also ships the spent models
- `components/NewCardDialog.tsx`, `components/NewCardDialogFooter.tsx` — the button's label and the warn-coloured
  status line
- `components/ReplyBox.tsx`, `components/ThreadFooter.tsx` — the thread's own gate
- `components/ModelSelect.tsx` — a used-up model reads "— at its limit"
- `docs/architecture/limits.md` (new), `docs/architecture/composer.md`

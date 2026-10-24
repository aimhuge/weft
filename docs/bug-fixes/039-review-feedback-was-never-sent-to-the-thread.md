# 039: review feedback was never sent to the thread

**Date:** 2026-10-25 · **Severity:** Medium (no crash; the review panel swallowed the user's feedback on every step they approved without sending it, and the thread finished its work without ever hearing the notes)

## Symptom

A thread left a review tour (a `weft-review` block) for its card. The user stepped through the tour, typed a
note on the first step ("the login is broken") and clicked **Looks good, next**.

The note vanished. The second step's feedback box was empty, **Send feedback** was disabled, and on the last
step the only thing to do was **Done**. Nothing on screen said a note was still waiting, so the user had no
way to know it existed.

Clicking **Done** sent exactly one message to the thread: `/weft:done`. The thread wrapped up its work having
never seen the note the user wrote — the feedback the tour exists to collect was dropped on the floor.

## Root cause

Two gaps, both in `components/ReviewPanelTour.tsx`.

**The drafts had no reader.** Each step's feedback was kept in its own localStorage slot, `weft.review.<cardId>.<step>`,
so that stepping through the tour did not overwrite an earlier step's note. But nothing in Weft read those
slots again: `go()` read the *destination* step's slot to fill the box, and `sendFeedback()` cleared the
*current* step's slot. A step you stepped away from was written to and never read — the note was still in
localStorage, but no code path ever surfaced it.

**The approve handler sent only the wrap-up.** The last step's button called `onSend("/weft:done")` and
nothing else, so the notes were not sent with the approval that ended the tour:

```tsx
// before — components/ReviewPanelTour.tsx
async function approve() {
  setApproved((prev) => new Set(prev).add(index));
  if (!last) go(index + 1);
  else void onSend("/weft:done");
}
```

The same held for **Looks good, next**: it moved to the next step and left the note where it was.

## Fix

The per-step drafts are now the panel's own state, not a side channel.

**`lib/review-feedback.ts`** (new) holds the drafts behind pure helpers: `feedbackKey(cardId, step)`,
`unsentSteps`, `unsentCount`, `feedbackMessage`, `collectFeedback`, `writeFeedback`, `clearFeedback`,
`clearAllFeedback`, `sendStepFeedback(cardId, step, title, total, send)` and
`flushFeedback(cardId, steps, send)`. `feedbackMessage` is the one place the wording lives, so the
single-step send and the flush cannot disagree about it. `flushFeedback` sends every step's unsent
feedback in **one** message and then clears the slots; if the send fails it throws and the drafts stay put,
so a note is never lost to a failed send.

**`components/ReviewPanelHeader.tsx`** (new) draws the tour's header — which step you're on, how many you
approved — and the badge that makes a waiting note visible:

```tsx
// after — components/ReviewPanelHeader.tsx
<span className="font-normal text-muted">
  step {Math.min(index + 1, total)} of {total} · {approved} approved
</span>
{unsent > 0 && (
  <span className="font-normal text-warn">
    · {unsent} step{unsent === 1 ? "" : "s"} with unsent feedback
  </span>
)}
```

**`components/ReviewPanelTour.tsx`** keeps the unsent count in state (refreshed on every keystroke, on every
send and on every step change) and flushes the drafts before it approves:

```tsx
// after — components/ReviewPanelTour.tsx
async function approve() {
  setApproved((prev) => new Set(prev).add(index));
  const pending = unsent;
  if (pending > 0) {
    setSending(true);
    try {
      await flushFeedback(cardId, steps, onSend);
      composer.current?.clear();
      setEmpty(true);
      setError("");
    } finally {
      setSending(false);
    }
    refreshUnsent();
  }
  if (!last) go(index + 1);
  else void onSend("/weft:done");
}
```

Sending one step's note goes through `sendStepFeedback`, which names the step it was written on and clears
that same step's slot — the step number the thread sees and the draft that was sent are always the same
one, so a note can't be labelled with the wrong step or clear the wrong slot.

So approving a step ("Looks good, next") or finishing the tour ("Done") sends every waiting note to the
thread first, and only then the wrap-up command. The notes go out in one message, each labelled with the
step it was written on:

```
Review feedback on step 1 of 3, “Sign-in”:
the login is broken

Review feedback on step 3 of 3, “Logo”:
the logo is wrong
```

**Key rule:** a draft a user wrote is only real once something can find it — surface the count of what is
waiting, and make the action that ends the flow send it.

## Files

- `lib/review-feedback.ts` (new) — the per-step drafts, the one place the message wording lives, and the
  send and flush
- `lib/review-feedback.test.ts` (new) — one slot per step, the count, the collected message, the flush, the
  single-step send, and that a failed send keeps the feedback
- `components/ReviewPanelHeader.tsx` (new) — the tour header and the unsent-feedback badge
- `components/ReviewPanelTour.tsx` — tracks the unsent count, flushes on approve, renders the header
- `components/ReviewPanel.test.tsx` — the badge, the kept draft, the flush on "Looks good, next" and on
  "Done", and one message carrying every step's feedback
- `docs/architecture/threads-and-sessions.md` — the "Review tour" section
- `docs/architecture/MAP.md` — the review tour's files in the file map

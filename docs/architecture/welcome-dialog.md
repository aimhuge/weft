# The welcome dialog

The first thing a new board shows: a full-window `Modal` over the whole window, portalled into
`document.body` (`components/WelcomeDialog.tsx`). Two ways in, and the difference between them is the
whole design of this dialog:

- **First launch** — `loadWelcome()` returns `welcome: null` plus a `preview`, and the dialog answers
  and saves the welcome (`answerWelcome()`) before it will let you start a thread.
- **Replay** — the avatar menu's *Replay the welcome* (or the command palette's `replay-welcome`) calls
  `replayWelcome()` in `lib/welcome-client.ts`: it runs `resetOnboarding()` (Settings → General's Reset tips:
  every drawer's intro video and the ask to sync come back) and dispatches `REPLAY_EVENT`; the dialog
  reloads with `loadWelcome(true)` (`?replay=1`) and shows the same screens as a **preview that saves
  nothing**. Only its final **Start thread** still does real work, because you asked for that one.

The first screen's narrated tour is a separate thing; see [welcome-tour.md](welcome-tour.md). The board
keeps `lib/welcome.ts` + `lib/welcome-preview.ts` + `lib/welcome-client.ts` + `app/api/welcome` +
`components/WelcomeDialog.tsx` + `components/WelcomeIntro.tsx` (Get ready) +
`components/WelcomeSteps.tsx` (the projects) + `components/WelcomeFirst.tsx` (the first thread, starters)
+ `components/WelcomeFooter.tsx` + `components/HistorySettings.tsx` (Settings → General).

## Steps and the chrome

`step` is one of `WelcomeStep` (`"ready" | "projects" | "first"`, exported from
`components/WelcomeFooter.tsx`). The list of steps is derived, not stored: with history it's
`["ready", "projects", "first"]`, with none it's `["ready", "first"]` (the projects screen is left out,
since there's nothing to import). `WelcomeStepBar` draws the bar above the body — "Step N of M" with a
dot per step, or, **on a replay**, the text "Replay · saves nothing" and a ✕. That component lives in
`WelcomeFooter.tsx` next to the footer it sits against; both were split out of `WelcomeDialog.tsx` to
keep that file under the eslint complexity cap (15).

The answer is saved on *leaving* the projects screen (`answer()` → `answerFor()` → `answerWelcome()`),
so the history import runs while you write the first prompt and the session sync adds no cards until
then.

## How it closes

The one behavior that differs between first launch and a replay is dismissal. It is decided in one
place, `WelcomeDialog.tsx`:

```tsx
const dismiss = () => { trackOnboarding("onboarding_skipped", { step, replay }); setPreview(null); };
const close = replay ? dismiss : () => {};
<Modal label="Welcome to Weft" layer="top" onClose={close} keepOnBackdrop={!replay} …>
```

- **On a replay**, `onClose` is the real `dismiss` and `keepOnBackdrop` is off, so the shared
  `Modal`'s Escape (`useEscape(true, onClose)`) and its backdrop `onMouseDown`
  (`keepOnBackdrop ? undefined : onClose`, `components/Modal.tsx:50`) both close it. The ✕ in
  `WelcomeStepBar` calls `dismiss` too. It behaves like every other dialog.
- **On first launch**, `onClose` is a no-op and `keepOnBackdrop` is on, so Escape and a backdrop click
  do nothing and there is no ✕: you came here to *answer*, and nothing is remembered if you drift off it
  before the projects screen. The only way off before that is finishing, or **Skip** on the first
  thread's screen (`WelcomeFooter`'s `onSkip`, the same `dismiss`).

Both paths fire the same analytics event, `onboarding_skipped`, so a replay's dismissal is counted
alongside a first launch's Skip. The event carries `replay`, so the two are distinguishable in PostHog.

A replay records **no answer**: `answer()` returns before `trackOnboarding("onboarding_projects_answered", …)`,
so a replay's *Bring in* / *Start empty* never reads as a real first-launch answer. `onboarding_first_thread`
does fire on a replay (it really does start a thread), and carries `replay` too.

## Things to know when editing

- **The dialog portals into `document.body`**, so its DOM is *not* inside the `render()` container —
  assert on `document.querySelector('[role="dialog"]')` (what `components/WelcomeDialog.test.tsx`
  does), not on the container.
- **The allow-list is the analytics contract.** `trackOnboarding` posts props to `/api/telemetry`, and
  `cleanProps()` (`lib/telemetry-events.ts`) drops anything not listed for the event, server-side, in
  `forwardOnboarding()` (`lib/telemetry-send.ts`). A prop that isn't listed for its event is **stripped
  before it is sent**, so the code can read as if it's tagged when it isn't. Add the prop to
  `ONBOARDING_EVENTS` in `lib/telemetry-events.ts` when you need it to arrive.
- **↵ is the primary.** The dialog's `onKeyDown` presses the footer's primary ref on Enter, except when
  focus is on another button or (in the prompt) unless ⌘/⌃ is held. `useStepVoice` speaks a line as
  each step opens, unless muted.
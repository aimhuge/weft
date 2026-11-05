# 046 — the dictation key opened a second recording instead of stopping the first

**Date:** 2026-10-28 · **Severity:** Medium (no crash and no data loss, but the mic stayed open with nobody listening, and the key did not do what it said)

## Symptom

The user started dictation with the key, then pressed the same key again to stop it. The recording
did not stop. On a machine slow enough to open the microphone slowly, pressing the key twice in
quick succession left **two** recorders running on the microphone, and the key would not stop
either of them.

## Root cause

`lib/use-dictation.ts` `toggle()` read the React state from the render closure:

```ts
toggle: () => (state === "recording" ? stopRef.current?.(true) : void start()),
```

and `start()` is asynchronous — it awaits the whisper availability check and
`navigator.mediaDevices.getUserMedia()` before it can set the state to `"recording"`:

```ts
async function start() {
  if (state !== "idle") return;   // the same stale closure
  ...
  const status = await whisperStatus();
  ...
  stream = await navigator.mediaDevices.getUserMedia(...);
  ...
  setState("recording");           // only now
}
```

React state is one render behind, so for the whole of that window `state` was still `"idle"` in the
closure the key handler held. A second press therefore took the `start()` branch again, and the
guard at the top of `start()` read the *same* stale closure value, so it did not stop the second
call either. Two `getUserMedia` calls, two `MediaRecorder`s, two live microphone streams.

The stop branch had the mirror problem: `stopRef.current` is only assigned once the recorder
exists, so a press during the startup window hit `stopRef.current?.(true)` with a `null` ref — a
no-op. The recording that was starting was never told to stop.

## Why it was hard to find

The bug only shows in the window between the key press and the microphone opening — on a fast
machine a few tens of milliseconds, on a slow one a few hundred. A test that starts the recording
and *then* toggles never sees it, because by then the state has caught up. It needs a microphone
whose promise is held open by the test.

It also hides behind the first bug (045): if the key never fired at all, there was no second press
to race with. Fixing 045 alone would have made this one visible to every user.

## Fix

The hook keeps the phase in a ref, so the key handler reads the truth rather than the last render,
and a second press during startup is remembered rather than dropped:

- `phaseRef` holds the current phase (`idle` / `recording` / `transcribing`); `setPhase()` writes
  both the ref and the React state, so the UI and the key handler never disagree.
- `abortRef` records that the key was pressed again while the microphone was opening. `start()`
  checks it after each await and, if set, releases the microphone and goes back to idle instead of
  recording.
- `toggle()` distinguishes the three cases: nothing running → start; recording but the recorder does
  not exist yet → abort the pending start; recording → stop and transcribe; transcribing → leave
  the turn in flight alone.
- `cancel()` (Escape) aborts a pending start the same way, so Escape during startup also leaves no
  microphone open.

**Why a ref and not `useState`.** The state is what the UI renders; the key handler needs the
*current* value, and React cannot give that synchronously from a render closure. The ref is the
only copy that is correct at the moment the key arrives.

## Key rule

**A key handler that can race an async start reads a ref, not render state.** React state is one
render behind, and any `await` between "the user asked" and "the work began" is a window where the
state still says the old thing. Claim the work synchronously, then check for a cancellation at each
await.

## Files

`lib/use-dictation.ts`, `lib/use-dictation-race.test.ts`, `lib/dictation.harness.ts`.

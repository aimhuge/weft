"use client";

// Something just came over a feature intro (lib/use-feature-intro.ts): a dialog (components/Modal.tsx, the achievement
// popup among them) or the New thread dialog and its pane (lib/use-board-dialogs.ts). Each tells the intros as it
// opens, and one that is playing pauses itself, so its voice doesn't talk on under whatever you're now looking at.
// A signal rather than a flag: the dialog an intro plays in has opened before the intro starts, so it never pauses it.

const listeners = new Set<() => void>();

export function coverIntros() {
  for (const listener of listeners) listener();
}

export function onIntroCovered(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

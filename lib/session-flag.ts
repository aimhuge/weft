"use client";

// A yes/no that lasts this session only, in memory, with a hook that re-renders on change. The full-page pane's
// rail and thread toggles use it (lib/pane-rail-open.ts): a fresh start always comes back to the plain view.
import { useSyncExternalStore } from "react";

export function sessionFlag(initial = false) {
  let value = initial;
  const listeners = new Set<() => void>();
  const get = () => value;
  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    get,
    set,
    toggle: () => set(!value),
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, () => initial),
  };
}

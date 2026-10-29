// The "welcome back" trigger: the first time you come back to Weft after being away for four hours
// or more. It's the app-level sibling of the automation triggers (lib/types-card.ts's AutomationTrigger):
// those fire on card events inside a thread, this one fires on the app regaining focus.
//
// The rule is deliberately narrow, because a trigger that fires too often is noise:
//   - It needs four hours of real absence. A lunch break doesn't count; an overnight does.
//   - It fires once per absence, not once per focus event. Coming back and alt-tabbing away for a
//     minute must not fire it again: the absence is what the trigger is about, so the moment it
//     fires, the absence is over.
//   - The first focus of a fresh install never fires it. There's no absence to come back from yet,
//     only a first look, and the welcome tour (lib/use-welcome-tour.ts) has that job.
//
// The last focus is kept in localStorage: it's a per-user, per-machine fact, not board state, and it
// has to survive a reload (the app is often closed rather than just blurred) without a round trip.

/** How long you have to be away before coming back counts. */
export const FOCUS_GAP_MS = 4 * 60 * 60 * 1000;

/** Where the last focus is remembered. */
export const LAST_FOCUS_KEY = "weft-last-focus";

/** Only this much of Storage is needed, so tests can pass a fake. */
export type FocusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * When you were last in the app, in epoch milliseconds, or null if we don't know.
 *
 * Anything unreadable is treated as unknown rather than as "never": a corrupt value should behave
 * like a missing one, not like a timestamp from the distant past that fires the trigger instantly.
 */
export function readLastFocus(storage: FocusStorage): number | null {
  try {
    const raw = storage.getItem(LAST_FOCUS_KEY);
    if (raw === null) return null;
    const at = Number(raw);
    // NaN, Infinity, and negative times are not times we wrote.
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Remember that the app had focus at this moment. */
export function writeLastFocus(at: number, storage: FocusStorage): void {
  try {
    storage.setItem(LAST_FOCUS_KEY, String(at));
  } catch {
    // Storage full or blocked: the trigger just can't tell how long you were away next time.
  }
}

/** Forget the last focus, so the next one counts as a first focus (never fires). */
export function clearLastFocus(storage: FocusStorage): void {
  try {
    storage.removeItem(LAST_FOCUS_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Whether coming back to the app now fires the trigger.
 *
 * `lastFocus` is when the app last had focus (null if unknown), and `now` is the current time. It
 * fires when we know the app had focus before, and it has been at least `gap` since.
 */
export function shouldFire(lastFocus: number | null, now: number, gap: number = FOCUS_GAP_MS): boolean {
  if (lastFocus === null) return false;
  const away = now - lastFocus;
  // A clock that jumped backwards (a sleep that reset it, a machine resuming) reads as no absence,
  // not as an enormous one.
  if (away < 0) return false;
  return away >= gap;
}

/**
 * The decision a focus event makes: fire the trigger, or not.
 *
 * `lastFocus` is what was remembered before this focus, `now` is the current time, and `storage` is
 * where the last focus lives. It returns whether to fire, and always records this focus as the
 * latest one, so the absence ends here either way: focus again in a minute and the trigger stays
 * quiet, because you were never away long enough to have come back.
 */
export function evaluateFocus(
  lastFocus: number | null,
  now: number,
  storage: FocusStorage,
  gap: number = FOCUS_GAP_MS,
): boolean {
  const fire = shouldFire(lastFocus, now, gap);
  writeLastFocus(now, storage);
  return fire;
}

/**
 * The storage-safe wrapper: reads the last focus, decides, and records this one.
 *
 * `storage` may be undefined on the server, where there's no window to focus and no localStorage
 * to read: there the trigger never fires.
 */
export function focusTriggerFired(
  storage: FocusStorage | undefined,
  now: number,
  gap: number = FOCUS_GAP_MS,
): boolean {
  if (!storage) return false;
  return evaluateFocus(readLastFocus(storage), now, storage, gap);
}

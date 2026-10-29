"use client";

import { useEffect, useRef } from "react";
import { FOCUS_GAP_MS, focusTriggerFired, type FocusStorage } from "./focus-trigger";

// Fires `onWelcomeBack` the first time the app is focused after four hours or more away
// (lib/focus-trigger.ts has the rule). It listens to both the window's focus event and the
// document's visibility change, because on macOS an app that was hidden comes back as a visibility
// change, and a window that was only blurred comes back as a focus event; either way the app has
// the user's attention again.
//
// The first focus of a fresh install never fires: there's no absence to come back from, and the
// welcome tour has that moment.
//
// `storage` is injectable so the rule can be tested without a browser; without one (the server)
// the hook does nothing.
export function useFocusTrigger(
  onWelcomeBack: () => void,
  options: { storage?: FocusStorage; gap?: number; target?: EventTarget } = {},
) {
  const { storage, gap = FOCUS_GAP_MS } = options;
  // The window is where the focus event lives; a caller can pass another target to listen elsewhere.
  const target = options.target ?? (typeof window === "undefined" ? undefined : window);
  // The callback is kept in a ref so a caller passing an inline function doesn't re-listen on every
  // render: the listener is added once, when the app mounts.
  const handler = useRef(onWelcomeBack);
  handler.current = onWelcomeBack;

  useEffect(() => {
    if (!target) return;
    const onFocus = () => {
      if (!storage) return;
      // A window that's focused but hidden (another space, a full-screen app over it) isn't the
      // user coming back to Weft; the visibility change is what fires then.
      if (typeof document !== "undefined" && document.hidden) return;
      if (focusTriggerFired(storage, Date.now(), gap)) handler.current();
    };
    const onVisibility = () => {
      // Only on the way back to visible: hiding the app is leaving, not returning.
      if (typeof document !== "undefined" && document.hidden) return;
      onFocus();
    };
    target.addEventListener("focus", onFocus);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      target.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [storage, gap, target]);
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { decideSplash, recordSeen, seenVersion, type ReleaseSplash } from "./release-splash";
import { loadWelcome } from "./welcome-client";

// When the "What's new" splash opens (lib/release-splash.ts has the rules). Decided once a launch, in the module: every
// mount waits on the same decision, so one that unmounts before it lands (React's dev double mount, the badges
// remounting) doesn't lose the splash, and none decides twice. Closed stays closed for the rest of the launch.
type Shown = { version: string; splash: ReleaseSplash };
let decision: Promise<Shown | null> | null = null;
let closedThisLaunch = false;

function decide(version: string): Promise<Shown | null> {
  decision ??= loadWelcome().then(
    (view) => {
      const { show, record } = decideSplash({ version, seen: seenVersion(), welcomed: Boolean(view.welcome) });
      // Recorded as it's decided, not on closing: a window closed with the splash up doesn't bring it back.
      if (record) recordSeen(version);
      return show ? { version, splash: show } : null;
    },
    // No answer about the welcome: decide again on the next mount rather than greet a fresh install with release notes.
    () => {
      decision = null;
      return null;
    },
  );
  return decision;
}

export function useReleaseSplash(version: string | undefined = process.env.NEXT_PUBLIC_APP_VERSION) {
  const [open, setOpen] = useState<Shown | null>(null);

  useEffect(() => {
    if (!version || closedThisLaunch) return;
    let live = true;
    void decide(version).then((shown) => {
      if (live && shown && !closedThisLaunch) setOpen(shown);
    });
    return () => {
      live = false;
    };
  }, [version]);

  const close = useCallback(() => {
    closedThisLaunch = true;
    setOpen(null);
  }, []);
  return { open, close };
}

// Tests only: a fresh launch.
export function resetDecidedForTests() {
  decision = null;
  closedThisLaunch = false;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { markStarAsked, markStarDone, readStar, shouldAskStar, snoozeStar, starAskedThisLaunch } from "./star-prompt";
import { splashShownThisLaunch } from "./use-release-splash";
import { syncAskedThisLaunch } from "./use-sync-prompt";
import { phoneOfferedThisLaunch } from "./use-testflight";
import { loadWelcome } from "./welcome-client";

// When the "Enjoying Weft?" ask opens (lib/star-prompt.ts has the rules). Nothing is fetched until the cheap local
// checks pass; then the welcome and whether you've already starred (gh, through /api/star) are read once.

// true starred, false not yet, null when gh can't tell (not installed, signed out).
export const loadStarred = (): Promise<boolean | null> =>
  apiFetch("/api/star")
    .then((r) => (r.ok ? (r.json() as Promise<{ starred?: boolean | null }>) : null))
    .then((v) => v?.starred ?? null)
    .catch(() => null);

// Star Weft's repo through gh; false when it couldn't.
export const starWeft = (): Promise<boolean> =>
  apiFetch("/api/star", { method: "POST" })
    .then((r) => (r.ok ? (r.json() as Promise<{ ok?: boolean }>) : null))
    .then((v) => Boolean(v?.ok))
    .catch(() => false);

const otherAsked = () => syncAskedThisLaunch() || phoneOfferedThisLaunch() || splashShownThisLaunch();

export function useStarPrompt(finished: number) {
  // Open with whether gh can star in one click (false: it can't tell, so the button opens the page instead).
  const [open, setOpen] = useState<{ gh: boolean } | null>(null);

  useEffect(() => {
    const gate = (welcomed: boolean) => ({ welcomed, stored: readStar(), finished, otherAsked: otherAsked(), now: Date.now() });
    if (starAskedThisLaunch() || !shouldAskStar(gate(true))) return;
    let live = true;
    void Promise.all([loadWelcome().then((v) => Boolean(v.welcome)), loadStarred()])
      .then(([welcomed, starred]) => {
        if (!live || starAskedThisLaunch()) return;
        // Already a stargazer: thank you, and never ask.
        if (starred === true) {
          markStarDone();
          return;
        }
        if (!shouldAskStar(gate(welcomed))) return;
        markStarAsked();
        setOpen({ gh: starred === false });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [finished]);

  const later = useCallback(() => {
    snoozeStar();
    setOpen(null);
  }, []);
  const done = useCallback(() => {
    markStarDone();
    setOpen(null);
  }, []);

  return { open, later, done };
}

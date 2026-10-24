"use client";

import { useEffect } from "react";
import type { BuildError } from "./build-error";
import { api } from "./client";

// Tells the server what the board saw break Weft, so it can mark the card that did it (lib/crash-blame.ts): a build
// error that names its file, and a full reload of the page (Fast Refresh gives up on an edit and reloads everything).
// The server's own deaths it learns from Electron. Dev mode only, like the build error itself: a packaged Weft has
// no Fast Refresh, and weft.zip has no cards to blame.

const LEFT_AT = "weft-left-at";
// A reload is the page coming back within this long of leaving.
const RELOAD_MS = 30_000;

const dev = () => process.env.NODE_ENV === "development";

// When the page last unloaded, if it just reloaded (not a first load or a navigation), else null.
export function reloadedFrom(storage: Pick<Storage, "getItem">, navType: string | undefined, now: number): number | null {
  if (navType !== "reload") return null;
  const left = Number(storage.getItem(LEFT_AT));
  return left && now - left >= 0 && now - left < RELOAD_MS ? left : null;
}

export function useBreakReport(error: BuildError | null) {
  const file = error?.file ?? null;
  useEffect(() => {
    if (!dev() || !file) return;
    api.reportBreak({ kind: "build", file }).catch(() => {});
  }, [file]);

  useEffect(() => {
    if (!dev()) return;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const at = reloadedFrom(sessionStorage, nav?.type, Date.now());
    sessionStorage.removeItem(LEFT_AT);
    if (at) api.reportBreak({ kind: "reload", at }).catch(() => {});
    const leave = () => sessionStorage.setItem(LEFT_AT, String(Date.now()));
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);
}

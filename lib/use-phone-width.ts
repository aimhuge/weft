"use client";

import { useSyncExternalStore } from "react";

// Below this, weft.zip draws the phone app's design (docs/architecture/new-card-parity.md).
export const PHONE_MAX_WIDTH = 767;
const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

// The query, or null where there's no window or no matchMedia (the server, jsdom), whatever the DOM types say.
function query(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  const media = (window as Partial<Pick<Window, "matchMedia">>).matchMedia;
  return typeof media === "function" ? media.call(window, QUERY) : null;
}

function subscribe(onChange: () => void) {
  const list = query();
  if (!list) return () => {};
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

const read = () => query()?.matches ?? false;

// Whether the window is phone width now, kept current as it's resized; false while the server renders.
export function usePhoneWidth(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

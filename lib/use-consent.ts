"use client";

import { useSyncExternalStore } from "react";
import { CONSENT_EVENT, readConsent, type Consent } from "./consent";

// The visitor's analytics choice as React state, following writeConsent()'s event (lib/consent.ts). undefined on the
// server and in the first hydrating render, where the choice can't be known, so the banner never flashes into the HTML.
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_EVENT, onChange);
}

export function useConsent(): Consent | null | undefined {
  return useSyncExternalStore(subscribe, () => readConsent(), () => undefined);
}

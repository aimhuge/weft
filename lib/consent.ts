// The weft.zip visitor's analytics choice. Nothing that sets cookies or records a session (PostHog with its session
// replay, GA4's gtag.js) loads until the visitor accepts in components/ConsentBanner.tsx; declining, or never
// choosing, keeps both off. One rule for every visitor rather than an EU/UK geo check: simpler, and nothing to get
// wrong at the border. The choice lives in localStorage (it's only read in the browser), and a window event tells
// code already on the page (lib/analytics.ts, the GA snippet) when it changes.

export type Consent = "granted" | "denied";

export const CONSENT_KEY = "weft-analytics-consent";
export const CONSENT_EVENT = "weft:consent";

// Storage can throw (Safari private windows, a blocked iframe) or be missing (the server): treat that as no choice yet.
export function readConsent(storage: Pick<Storage, "getItem"> = globalThis.localStorage): Consent | null {
  try {
    const value = storage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function writeConsent(
  value: Consent,
  storage: Pick<Storage, "setItem"> = globalThis.localStorage,
  target: EventTarget = window,
): void {
  try {
    storage.setItem(CONSENT_KEY, value);
  } catch {
    // Not stored: the choice still holds for this page.
  }
  target.dispatchEvent(new CustomEvent<Consent>(CONSENT_EVENT, { detail: value }));
}

// Runs start() once the visitor has accepted: now if they already have, else on the first "granted" event.
export function whenConsented(
  start: () => void,
  storage: Pick<Storage, "getItem"> = globalThis.localStorage,
  target: EventTarget = window,
): () => void {
  if (readConsent(storage) === "granted") {
    start();
    return () => {};
  }
  const listener = (event: Event) => {
    if ((event as CustomEvent<Consent>).detail !== "granted") return;
    target.removeEventListener(CONSENT_EVENT, listener);
    start();
  };
  target.addEventListener(CONSENT_EVENT, listener);
  return () => target.removeEventListener(CONSENT_EVENT, listener);
}

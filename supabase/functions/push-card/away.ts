// Whether the user is away, so a phone push is worth sending (docs/architecture/mobile.md#push). Pure, with no Deno or
// npm imports, so the push-card Edge Function (./index.ts) and Vitest share it.
//
// Present means either: a Mac of theirs reported in the last 3 minutes with the keyboard and mouse touched under 5
// minutes ago (public.device_presence, written by Weft every minute: lib/mac-presence.ts), or a phone of theirs had
// the app in the foreground in the last 2 minutes (push_devices.foreground_at, set by public.touch_push_device). No
// rows at all is away: a Mac that's off, or a Weft too old to report, must never swallow a push.

export interface MacPresence {
  idle_seconds: number | null;
  updated_at: string | null;
}

export interface PhonePresence {
  foreground_at: string | null;
}

// A Mac reports every 60 s, so 3 minutes forgives two missed beats.
export const MAC_FRESH_MS = 3 * 60_000;
export const MAC_IDLE_SECONDS = 300;
// The phone touches its row once a minute while open.
export const PHONE_FRESH_MS = 2 * 60_000;

export type PresentOn = "mac" | "phone";

const age = (iso: string | null, now: number): number => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? now - at : Infinity;
};

export function macActive(macs: MacPresence[], now: number): boolean {
  return macs.some((m) => age(m.updated_at, now) <= MAC_FRESH_MS && typeof m.idle_seconds === "number" && m.idle_seconds < MAC_IDLE_SECONDS);
}

export function phoneForeground(phones: PhonePresence[], now: number): boolean {
  return phones.some((p) => age(p.foreground_at, now) <= PHONE_FRESH_MS);
}

// Where the user is, or null when away and the push should go.
export function presentOn(macs: MacPresence[], phones: PhonePresence[], now: number): PresentOn | null {
  if (macActive(macs, now)) return "mac";
  if (phoneForeground(phones, now)) return "phone";
  return null;
}

export const isAway = (macs: MacPresence[], phones: PhonePresence[], now: number): boolean => presentOn(macs, phones, now) === null;

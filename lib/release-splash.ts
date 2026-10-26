import SPLASHES from "./release-splashes.json";

// The "What's new" splash (components/ReleaseSplash.tsx): the first time Weft opens on a version that has a splash,
// it shows that version's few lines once, and an occasional video. The lines are written at release time by the
// Copywriter (scripts/release-splash.mjs, the release skill in .claude/skills/release) into lib/release-splashes.json,
// which ships inside the app, so the update brings its own splash. The version you last saw lives in localStorage,
// like the sync prompt's box; Settings → General → Reset tips clears it (lib/welcome-client.ts resetOnboarding).

export const SPLASH_SEEN_KEY = "weft-splash-version";

export interface ReleaseSplash {
  // Two or three short lines, each one change and its payoff.
  lines: string[];
  // A video under public/, e.g. "/whats-new/0.7.0.mp4", for the releases that have one.
  video?: string;
}

export type Splashes = Record<string, ReleaseSplash>;

// Whether "a.b.c" comes before another; the splash only needs the numbers (no prereleases ship).
function olderThan(a: string, b: string): boolean {
  const nums = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}

type SplashStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): SplashStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// The splash written for a version, or null when it has none (most patch releases) or it has no lines.
export function splashFor(version: string, splashes: Splashes = SPLASHES): ReleaseSplash | null {
  const entry = splashes[version];
  return entry && Array.isArray(entry.lines) && entry.lines.length > 0 ? entry : null;
}

export interface SplashGate {
  version: string;
  // The version the splash last recorded, null when nothing is stored.
  seen: string | null;
  // The first-launch welcome is answered: a fresh install has nothing new to hear about.
  welcomed: boolean;
}

// What to do at launch: show this version's splash, quietly record the version, or nothing.
// A fresh install records its version before the welcome, so the splash waits for the next update. Someone who had
// Weft before this splash existed has no version stored but a welcome answered, so they see the first one.
export function decideSplash(gate: SplashGate, splashes?: Splashes): { show: ReleaseSplash | null; record: boolean } {
  const { version, seen, welcomed } = gate;
  if (seen === version) return { show: null, record: false };
  if (!welcomed) return { show: null, record: true };
  // A downgrade, or a version stored by a newer Weft: say nothing, and start counting from here.
  if (seen && olderThan(version, seen)) return { show: null, record: true };
  return { show: splashFor(version, splashes), record: true };
}

export function seenVersion(storage: SplashStorage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(SPLASH_SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function recordSeen(version: string, storage: SplashStorage | null = defaultStorage()) {
  try {
    storage?.setItem(SPLASH_SEEN_KEY, version);
  } catch {
    // Full or blocked storage: the splash shows once more next launch, which is all that's lost.
  }
}

export function resetSplash(storage: SplashStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(SPLASH_SEEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

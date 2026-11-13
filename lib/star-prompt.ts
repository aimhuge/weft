// The "Enjoying Weft?" ask (components/StarPrompt.tsx): once you've finished a handful of threads, Weft asks for a star
// on GitHub. Starring is one click through the gh CLI you're signed in to (lib/github-star.ts, /api/star); without gh it
// opens the repo's page instead. It never asks someone who has already starred, never on a launch that showed another
// dialog, and Later waits a couple of weeks. What you chose lives in localStorage, like the phone prompt's flag, until
// Settings → General → Reset tips (lib/welcome-client.ts resetOnboarding).

export const STAR_REPO = "aimhuge/weft";
export const STAR_URL = `https://github.com/${STAR_REPO}`;

export const STAR_PROMPT_KEY = "weft-star-prompt";

// Late enough that Weft has earned it: well past the sync ask (after the first) and the phone prompt (after the third).
export const STAR_PROMPT_AFTER = 10;

// How long Later waits before asking again.
export const STAR_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// What's stored: "done" once you've starred or said don't ask, else the time Later lets it ask again.
export type StarStored = { kind: "open" } | { kind: "done" } | { kind: "snoozed"; until: number };

type PromptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): PromptStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// Missing, blocked or broken storage reads as done: a prompt that can't remember its answer would keep coming back.
export function readStar(storage: PromptStorage | null = defaultStorage()): StarStored {
  try {
    if (!storage) return { kind: "done" };
    const raw = storage.getItem(STAR_PROMPT_KEY);
    if (raw === null) return { kind: "open" };
    if (raw === "done") return { kind: "done" };
    const until = Number(raw);
    return Number.isFinite(until) ? { kind: "snoozed", until } : { kind: "done" };
  } catch {
    return { kind: "done" };
  }
}

function write(value: string, storage: PromptStorage | null) {
  try {
    storage?.setItem(STAR_PROMPT_KEY, value);
  } catch {
    // Full or blocked storage reads as done anyway.
  }
}

// Starred, or "Don't ask again": never again.
export function markStarDone(storage: PromptStorage | null = defaultStorage()) {
  write("done", storage);
}

// Later (or the dialog closed): ask again after STAR_SNOOZE_MS.
export function snoozeStar(now = Date.now(), storage: PromptStorage | null = defaultStorage()) {
  write(String(now + STAR_SNOOZE_MS), storage);
}

export function resetStarPrompt(storage: PromptStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(STAR_PROMPT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export interface StarGate {
  welcomed: boolean;
  stored: StarStored;
  finished: number;
  // Another dialog (the sync ask, the phone prompt, What's new) opened this launch: one a launch is plenty.
  otherAsked: boolean;
  now: number;
}

export function shouldAskStar(g: StarGate): boolean {
  if (!g.welcomed || g.otherAsked || g.finished < STAR_PROMPT_AFTER) return false;
  if (g.stored.kind === "done") return false;
  return g.stored.kind === "open" || g.now >= g.stored.until;
}

// Once a launch, kept here (not in the hook) so the phone prompt (lib/use-testflight.ts) can wait for it too without
// the two hooks importing each other.
let askedThisLaunch = false;
export const starAskedThisLaunch = () => askedThisLaunch;
export function markStarAsked(asked = true) {
  askedThisLaunch = asked;
}

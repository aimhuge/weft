// The "Weft on your phone" prompt (components/PhonePrompt.tsx): once you're signed in, welcomed and a few threads
// have finished, Weft shows the phone app's TestFlight link as a QR code, with a button that emails you the invite
// (docs/architecture/mobile.md#testflight). Once only: closing it either way sets a flag in localStorage for good,
// until Settings → General → Reset tips (lib/welcome-client.ts resetOnboarding).

export const PHONE_PROMPT_KEY = "weft-phone-prompt-seen";

// Late enough that the sync ask (after the first) has had its turn and Weft has shown what it does.
export const PHONE_PROMPT_AFTER = 3;

type PromptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): PromptStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

// Missing, blocked or broken storage reads as "seen": a prompt that can't remember being closed would come back.
export function phonePromptSeen(storage: PromptStorage | null = defaultStorage()): boolean {
  try {
    return !storage || storage.getItem(PHONE_PROMPT_KEY) === "1";
  } catch {
    return true;
  }
}

export function markPhonePromptSeen(storage: PromptStorage | null = defaultStorage()) {
  try {
    storage?.setItem(PHONE_PROMPT_KEY, "1");
  } catch {
    // Full or blocked storage reads as seen anyway.
  }
}

export function resetPhonePrompt(storage: PromptStorage | null = defaultStorage()) {
  try {
    storage?.removeItem(PHONE_PROMPT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

export interface PhoneGate {
  signedIn: boolean;
  welcomed: boolean;
  seen: boolean;
  finished: number;
  // The sync ask opened this launch: one dialog a launch is plenty.
  syncAsked: boolean;
  // The phones already signed in to the account (GET /api/push-devices), null until it answers.
  phones: number | null;
  // The TestFlight link, null until weft.zip answers with one.
  url: string | null;
}

export const shouldOfferPhone = (g: PhoneGate): g is PhoneGate & { url: string } =>
  g.signedIn && g.welcomed && !g.seen && !g.syncAsked && g.finished >= PHONE_PROMPT_AFTER && g.phones === 0 && !!g.url;

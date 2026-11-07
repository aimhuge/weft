"use client";

// Your Weft account on the board side: the top bar's sign-in button, Settings →
// Weft account, and the puku-trial upgrade prompt all use this. It's now a thin
// re-export of `useAuth` from `lib/auth/hooks.ts` that adds back the bits the
// board-specific callers need:
//
//   * `sendLink(email)` — the magic-link path the puku-trial prompt uses.
//
// The polling-while-waiting block, the cross-instance `weft:account` event,
// and the OAuth round trip live in `useAuth` so the deployed `/login` page and
// the in-app dialog share the same code.
import { useCallback, useState } from "react";
import { api } from "./client";
import { useAuth, type AuthBusy, type AuthState, type AuthWaiting } from "./auth/hooks";
import type { AccountProvider, AccountView } from "./types";

// Re-export the event name so the existing tests / imports keep working.
export { ACCOUNT_EVENT } from "./auth/hooks";
export const POLL_MS = 2000;
export const WAIT_MS = 5 * 60 * 1000;
export const PROVIDER_LABELS: Record<AccountProvider, string> = { github: "GitHub" };

// The board's call sites still expect the union of {provider, "email", "signout"}.
// `useAuth` only knows OAuth and signout, so we extend it locally.
export type AccountBusy = AuthBusy | "email" | null;
export type AccountState = AuthState;
// The board's `waiting` includes an `email: boolean` flag (the prompt says
// "Open it on this Mac" for emails and "Finish in your browser" otherwise).
// The hook's `AuthWaiting.what` is the provider id ("github") or, for a
// magic link, the email address; the board's call sites expect the human
// label ("GitHub") when it's a provider, and the raw email when it's not.
export interface AccountWaiting {
  what: string;
  email: boolean;
  since: number;
}

function toAccountWaiting(w: AuthWaiting | null, emailWaiting: string | null): AccountWaiting | null {
  if (emailWaiting) return { what: emailWaiting, email: true, since: Date.now() };
  if (!w) return null;
  const label = (PROVIDER_LABELS as Record<string, string>)[w.what] ?? w.what;
  return { what: label, email: false, since: w.since };
}

export function announceAccountChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("weft:account"));
}

export function useAccount() {
  const { state: authState, busy: authBusy, error, waiting, signInWithOAuth, signOut } = useAuth();
  const [emailBusy, setEmailBusy] = useState<"email" | null>(null);
  const [emailWaiting, setEmailWaiting] = useState<string | null>(null);

  const sendLink = useCallback(
    (email: string) => {
      const trimmed = email.trim();
      setEmailBusy("email");
      setEmailWaiting(trimmed);
      return (async () => {
        try {
          await api.magicLink(email);
          setTimeout(() => setEmailWaiting(null), WAIT_MS);
        } finally {
          setEmailBusy(null);
        }
      })();
    },
    [],
  );

  // The board's call sites pass the provider as a string; we adapt to the hook's
  // object signature. `AccountProvider` is "github", the only OAuth provider
  // the auth hook knows.
  const signIn = useCallback(
    (provider: AccountProvider) => signInWithOAuth({ provider }),
    [signInWithOAuth],
  );

  return {
    state: authState,
    busy: emailBusy ?? authBusy,
    waiting: toAccountWaiting(waiting, emailWaiting),
    error,
    signIn,
    sendLink,
    signOut,
  };
}

// Re-export so any module that wants the raw hook can have it.
export { useAuth };

// A typed view helper for tests that want to assert against an AccountView.
export type { AccountView };

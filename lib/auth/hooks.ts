"use client";

// The sign-in hook. Mirrors `@aimhuge/auth/client`'s `useAuth` so swapping to the
// package later is a one-line import. Today it drives our existing
// `app/api/account` JSON API; the package's `signInWithOAuth` would call the
// same Supabase `signInWithOAuth` under the hood.
//
// The polling-then-fade block (every 2s while `waiting`, up to 5 minutes) is the
// bit the package doesn't own: it assumes the browser tab is still on the page
// when the round trip returns, but the board is in a separate Electron window
// and the round trip comes back to the system browser.
import { useCallback, useEffect, useState } from "react";
import { api } from "../client";
import type { AccountProvider, AccountView } from "../types";
import { openExternal } from "./desktop";

export type AuthProvider = Extract<AccountProvider, "github">;

export type UseAuthOptions = {
  /** The auth path the round trip should land on. Default "/". */
  defaultNext?: string;
};

export type AuthBusy = AuthProvider | "signout" | null;

export type AuthState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; view: AccountView };

export type AuthWaiting = { what: string; since: number };

/** How long a sign-in can stay "waiting" before the spinner gives up. */
const WAIT_MS = 5 * 60 * 1000;
/** How often to re-check the server while waiting. */
const POLL_MS = 2000;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The window event name every `useAuth` instance fires when the session changes. */
export const ACCOUNT_EVENT = "weft:account";

/** Fire a `weft:account` window event so other `useAccount` instances reload. */
function announceChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACCOUNT_EVENT));
}

/**
 * Start an OAuth round trip.
 *
 *   signInWithOAuth({ provider: "github" }) // in-app: opens system browser,
 *                                              // comes back via weft:// or
 *                                              // the loopback /api/auth/callback
 *   signInWithOAuth({ provider: "github", next: "/app" })
 *
 * Today the actual call goes to `POST /api/account` (our `startSignIn` lib fn);
 * the package's `useAuth.signInWithOAuth` will replace this body verbatim.
 */
export function useAuth(options: UseAuthOptions = {}) {
  const defaultNext = options.defaultNext ?? "/";
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  const [busy, setBusy] = useState<AuthBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<AuthWaiting | null>(null);

  const load = useCallback(
    () =>
      api.account().then(
        (view) => {
          setState({ kind: "ready", view });
          if (view.user) setWaiting(null);
          return view;
        },
        (err: unknown) => {
          setState({ kind: "error", error: message(err) });
          return null;
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener("weft:account", reload);
    return () => window.removeEventListener("weft:account", reload);
  }, [load]);

  // While we're waiting for the OAuth round trip, poll the server every 2s.
  // On success, fire the cross-instance event so every useAccount reloads.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - waiting.since > WAIT_MS) {
        setWaiting(null);
        return;
      }
      void load().then((view) => {
        if (view?.user) announceChange();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const signInWithOAuth = useCallback(
    async (opts: { provider: AuthProvider; next?: string }) => {
      // The destination is built from the explicit `next` option, falling back
      // to the hook's `defaultNext`. Both are passed through to the server so
      // the OAuth `redirectTo` lands on the right page.
      const next = opts.next && opts.next !== "/" ? opts.next : defaultNext;
      setBusy(opts.provider);
      setError(null);
      try {
        const { url } = await api.signIn(opts.provider, next);
        openExternal(url);
        setWaiting({ what: opts.provider, since: Date.now() });
        setBusy(null);
        return { error: null };
      } catch (err) {
        setError(message(err));
        setBusy(null);
        return { error: err instanceof Error ? err : new Error(message(err)) };
      }
    },
    [defaultNext],
  );

  const signOut = useCallback(async () => {
    setBusy("signout");
    setError(null);
    try {
      await api.signOut();
      announceChange();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }, []);

  return { state, busy, error, waiting, signInWithOAuth, signOut };
}

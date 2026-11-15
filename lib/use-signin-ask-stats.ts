"use client";

import { useCallback, useEffect, useRef } from "react";
import { trackOnboarding } from "./telemetry-client";

// Whether Weft's two sign-in asks work (docs/architecture/analytics.md): the welcome's sign-in screen
// (components/WelcomeAccount.tsx) and "Sign in to Weft?" after the first finished thread (components/SyncPromptDialog.tsx).
// Each sends shown once it opens signed out, clicked on its GitHub button, declined on Not now, and completed when the
// account turns up while it is still open, so the funnel can tell skipping the account from never opening Weft.
export type SignInAskWhere = "welcome" | "first_thread";

// signedOut is null while the account is still loading: nothing is sent until it is known.
export function useSignInAskStats(where: SignInAskWhere, signedOut: boolean | null) {
  const shown = useRef(false);
  const completed = useRef(false);

  useEffect(() => {
    if (signedOut === true && !shown.current) {
      shown.current = true;
      trackOnboarding("signin_ask_shown", { where });
    }
    if (signedOut === false && shown.current && !completed.current) {
      completed.current = true;
      trackOnboarding("signin_ask_completed", { where });
    }
  }, [signedOut, where]);

  const clicked = useCallback(() => trackOnboarding("signin_ask_clicked", { where }), [where]);
  const declined = useCallback((never = false) => {
    if (shown.current && !completed.current) trackOnboarding("signin_ask_declined", { where, never });
  }, [where]);

  return { clicked, declined };
}

"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import posthog from "posthog-js";
import { analyticsOn } from "@/lib/analytics";
import { DARK_QUERY, applyTheme } from "@/lib/theme";

type AccountIdentity = {
  id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
};

function isAccountIdentity(value: unknown): value is AccountIdentity {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    (user.email === null || typeof user.email === "string") &&
    (user.name === null || typeof user.name === "string") &&
    (user.provider === null || typeof user.provider === "string")
  );
}

// Keeps <html data-theme> right after the head script sets it: React's dev remount clears the
// attribute, and "System" has to follow the OS when it switches.
export default function ThemeSync() {
  const identifiedUserId = useRef<string | null>(null);

  useLayoutEffect(() => {
    applyTheme();
    const media = matchMedia(DARK_QUERY);
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, []);

  useEffect(() => {
    // Only on weft.zip; a local board never identifies anyone to PostHog (lib/analytics-gate.ts).
    if (!analyticsOn()) return;

    let active = true;
    const synchronizeIdentity = async () => {
      try {
        const response = await fetch("/api/account");
        if (!response.ok) return;
        const view = (await response.json()) as { user?: unknown };
        if (!active) return;

        if (!isAccountIdentity(view.user)) {
          if (identifiedUserId.current) {
            posthog.reset();
            identifiedUserId.current = null;
          }
          return;
        }

        if (identifiedUserId.current !== view.user.id) {
          posthog.identify(view.user.id, {
            email: view.user.email ?? undefined,
            name: view.user.name ?? undefined,
            provider: view.user.provider ?? undefined,
          });
          identifiedUserId.current = view.user.id;
        }
      } catch {
        // Identity is optional: leave anonymous analytics intact if the account check fails.
      }
    };

    const resetForWebSignOut = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || new URL(form.action).pathname !== "/auth/sign-out") return;
      posthog.reset();
      identifiedUserId.current = null;
    };

    const synchronizeIdentityOnAccountChange = () => void synchronizeIdentity();

    void synchronizeIdentity();
    window.addEventListener("weft:account", synchronizeIdentityOnAccountChange);
    document.addEventListener("submit", resetForWebSignOut);
    return () => {
      active = false;
      window.removeEventListener("weft:account", synchronizeIdentityOnAccountChange);
      document.removeEventListener("submit", resetForWebSignOut);
    };
  }, []);

  return null;
}

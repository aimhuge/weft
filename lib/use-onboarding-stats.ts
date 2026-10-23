"use client";

import { useEffect, useRef } from "react";
import { trackOnboarding } from "./telemetry-client";

// The welcome's own anonymous stats (lib/telemetry.ts, components/WelcomeDialog.tsx): "started" once per showing, and
// each step with how long the last one took. Clicks (log in, skip, the answers, start) are tracked where they happen.
export function useOnboardingStats({ preview, replay, step, cliReady }: { preview: { projects: unknown[] } | null; replay: boolean; step: string; cliReady: boolean | null }) {
  const open = preview !== null;
  const hasHistory = (preview?.projects.length ?? 0) > 0;
  const startedAt = useRef<number | null>(null);
  const stepAt = useRef(0);

  // Started: once the CLI check is in, so cli_ready is known.
  useEffect(() => {
    if (!open) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current !== null || cliReady === null) return;
    startedAt.current = Date.now();
    stepAt.current = Date.now();
    trackOnboarding("onboarding_started", { has_history: hasHistory, cli_ready: cliReady, replay });
  }, [open, cliReady, hasHistory, replay]);

  const lastStep = useRef(step);
  useEffect(() => {
    if (!open || step === lastStep.current) return;
    lastStep.current = step;
    const now = Date.now();
    trackOnboarding("onboarding_step", { step, seconds_on_last: Math.round((now - stepAt.current) / 1000) });
    stepAt.current = now;
  }, [open, step]);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The status a connector panel shows: loading, the error the check failed with, or the status itself.
// Every panel in Settings → Connectors loads one the same way, and polls it while the tool is working.
export type LoadState<T> = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; status: T };

// The error a failed check shows, as text.
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A connector panel's status: the check that ran, the three states it can be in, and the poll that keeps it
 * current while the tool is working (a browser sign-in, an install).
 *
 * load asks for the status. pollMs and pollWhile are the poll: how often to ask again, and while what (the
 * last status, or null before the first answer). Leaving them out means no polling.
 *
 * refresh looks again with the loading state between (a panel's Refresh button); reload looks again without it
 * (something ended, so the check runs under the old status); accept puts a status the panel got another way
 * (an action's own answer) in place.
 */
export function useConnectorStatus<T>({
  load,
  pollMs,
  pollWhile,
}: {
  load: () => Promise<T>;
  pollMs?: number;
  pollWhile?: (status: T | null) => string | boolean | null;
}) {
  const [state, setState] = useState<LoadState<T>>({ kind: "loading" });
  // The caller's load, kept in a ref so the check below doesn't restart on every render. The effect that
  // fills it is declared before the one that checks, so a check always asks with the newest load.
  const ask = useRef(load);
  useEffect(() => {
    ask.current = load;
  }, [load]);

  const fetchStatus = useCallback(
    () =>
      ask.current().then(
        (next) => setState({ kind: "ready", status: next }),
        (err: unknown) => setState({ kind: "error", error: message(err) }),
      ),
    [],
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // The status as it is now, so pollWhile can read it without the panel passing it down.
  const current = state.kind === "ready" ? state.status : null;

  // Polls while the caller says so: a browser sign-in under way, an install running. The key is what the
  // condition returned: when it changes, the poll starts over (a new sign-in, another install).
  const key = pollWhile?.(current) ?? null;
  useEffect(() => {
    if (!key || pollMs === undefined) return;
    const timer = setInterval(() => void fetchStatus(), pollMs);
    return () => clearInterval(timer);
  }, [key, pollMs, fetchStatus]);

  // Looks again, with the loading state between: what a panel's Refresh button does.
  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    void fetchStatus();
  }, [fetchStatus]);

  // Puts a status the panel got another way in place, without a loading state between.
  const accept = useCallback((next: T) => setState({ kind: "ready", status: next }), []);

  return { load: state, refresh, reload: fetchStatus, accept, busy: state.kind === "loading" };
}

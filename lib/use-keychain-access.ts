"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { AuditActivity, KeychainRecord, VaultGrant } from "./keychain-audit-types";
import { vaultBridge } from "./vault-view";

// How often the open card looks again, so a thread's fill shows up while you watch.
const REFRESH_MS = 10_000;
// Waiting lines the card asks main for; it shows fewer until Show more.
const LIMIT = 500;

// The log as your Weft account keeps it (app/api/account/keychain-events); a failed read throws its error.
async function fetchRecord(): Promise<KeychainRecord> {
  const res = await apiFetch("/api/account/keychain-events");
  const body = (await res.json()) as KeychainRecord & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  return body;
}

/**
 * Settings → Security's Keychain access card, refreshed while it's open: the log from your Weft account, the lines
 * still waiting on the Mac and the grants from main.
 */
export function useKeychainAccess() {
  const bridge = vaultBridge();
  const [activity, setActivity] = useState<AuditActivity | null>(null);
  const [record, setRecord] = useState<KeychainRecord | null>(null);
  const [grants, setGrants] = useState<VaultGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const supported = Boolean(bridge?.activity && bridge.grants);

  // Asks main again; state is set in the promise's callbacks.
  const load = useCallback(() => {
    if (!bridge?.activity || !bridge.grants) return Promise.resolve();
    return Promise.all([bridge.activity(LIMIT), bridge.grants(), fetchRecord()]).then(
      ([a, g, r]) => {
        setActivity(a);
        setGrants(g);
        setRecord(r);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [bridge]);

  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const first = setTimeout(() => void load(), 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [load]);

  const revoke = useCallback(
    async (g: VaultGrant) => {
      await bridge?.revoke?.(g.card, g.id);
      await load();
    },
    [bridge, load],
  );

  return { supported, activity, record, grants, error, revoke, reload: load };
}

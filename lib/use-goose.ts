"use client";

// The Goose drawer's providers and the two actions it offers (save a key, forget one), from Electron main.
//
// The key itself never comes back: the board sends it once and main seals it in the Keychain. What comes back is
// whether the provider has a key and the non-secret metadata beside it (a custom endpoint, the model).

import { useCallback, useEffect, useState } from "react";
import { gooseBridge, type GooseProviderView } from "./goose-provider";

export interface GooseActions {
  providers: GooseProviderView[];
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  // Saves a provider's key. Returns true when it worked.
  setKey: (providerId: string, token: string, extra?: { baseUrl?: string; model?: string }) => Promise<boolean>;
  // Removes a provider's key. Returns true when it worked.
  forget: (providerId: string) => Promise<boolean>;
}

/** The providers Goose can use, loaded on mount, with the actions that change them. */
export function useGooseProviders(active = true): GooseActions {
  const [providers, setProviders] = useState<GooseProviderView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const bridge = gooseBridge();
    if (!bridge) return;
    try {
      const view = await bridge.listProviders();
      setProviders(view.providers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const load = () => void reload();
    if (active) load();
  }, [active, reload]);

  // Runs a change against main, then shows the providers again.
  const change = useCallback(
    async (run: () => Promise<unknown>): Promise<boolean> => {
      const bridge = gooseBridge();
      if (!bridge) return false;
      setBusy(true);
      try {
        await run();
        await reload();
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const setKey = useCallback(
    (providerId: string, token: string, extra?: { baseUrl?: string; model?: string }) =>
      change(async () => {
        const bridge = gooseBridge();
        await bridge?.setProviderKey({ providerId, token, ...extra });
      }),
    [change],
  );

  const forget = useCallback(
    (providerId: string) =>
      change(async () => {
        const bridge = gooseBridge();
        await bridge?.forgetProviderKey({ providerId });
      }),
    [change],
  );

  return { providers, error, busy, reload, setKey, forget };
}

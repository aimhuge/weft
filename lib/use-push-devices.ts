"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { PushDevicesView } from "./push-devices";

// The Phones card on Settings → Sync (components/PhoneSettings.tsx): the phones paired to your account, read once
// when the page opens and again after a Remove, through /api/push-devices.

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const load = async () => readJson<PushDevicesView>(await apiFetch("/api/push-devices"));

export function usePushDevices() {
  const [view, setView] = useState<PushDevicesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((answer: PushDevicesView) => {
    setView(answer);
    setError(null);
  }, []);
  const failed = useCallback((err: unknown) => setError(err instanceof Error ? err.message : String(err)), []);
  const reload = useCallback(() => load().then(apply, failed), [apply, failed]);

  useEffect(() => {
    load().then(apply, failed);
  }, [apply, failed]);

  const remove = useCallback(
    async (id: string) => {
      await readJson(await apiFetch(`/api/push-devices?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
      await reload();
    },
    [reload],
  );

  return { view, error, remove };
}

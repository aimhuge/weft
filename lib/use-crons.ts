"use client";

import { useCallback, useState } from "react";
import { cronApi } from "./cron-client";
import type { Cron, CronInput, CronPatch } from "./cron-types";
import { useBoardEvents } from "./use-events";
import { isWorkerItem, WORKER_LIST_SETTLE_MS } from "./worker-item-id";

// Every cron, for the rail's ⏰ count, its Crons drawer and the thread header's ⏰. Loaded when the board starts,
// and again on the server's "crons" event (made, changed, run or deleted anywhere: the popover, a thread's MCP call,
// the scheduler). The calls throw, for the caller to show.
export function useCrons() {
  const [crons, setCrons] = useState<Cron[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCrons(await cronApi.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // onOpen runs as the event stream connects (or at once, when it already is) and on every reconnect: the first load.
  useBoardEvents(
    (event) => {
      if (event.type === "crons") void reload();
    },
    () => void reload(),
  );

  // A Weft Worker's cron changes on the worker (lib/worker-list-acts.ts), and no "crons" event comes from there: the list
  // is read again once the worker has republished it.
  const settle = (id: string) => {
    if (isWorkerItem(id)) setTimeout(() => void reload(), WORKER_LIST_SETTLE_MS);
  };
  const put = (cron: Cron) => setCrons((list) => (list.some((c) => c.id === cron.id) ? list.map((c) => (c.id === cron.id ? cron : c)) : [...list, cron]));
  return {
    crons,
    error,
    // A cron made on a Weft Worker (cron.create): read the list again once the worker has republished it.
    later: () => void setTimeout(() => void reload(), WORKER_LIST_SETTLE_MS),
    create: async (input: CronInput) => {
      const cron = await cronApi.create(input);
      put(cron);
      return cron;
    },
    // The change shows at once (a switch flips the moment you click it); a refusal reloads what the server has.
    update: async (id: string, patch: CronPatch) => {
      setCrons((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      try {
        const cron = await cronApi.update(id, patch);
        if (cron) put(cron);
        else settle(id);
      } catch (err) {
        void reload();
        throw err;
      }
    },
    remove: async (id: string) => {
      await cronApi.remove(id);
      setCrons((list) => list.filter((c) => c.id !== id));
      settle(id);
    },
    run: async (id: string) => {
      const card = await cronApi.run(id);
      settle(id);
      return card;
    },
  };
}

export type CronsState = ReturnType<typeof useCrons>;

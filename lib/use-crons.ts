"use client";

import { useCallback, useState } from "react";
import { cronApi } from "./cron-client";
import type { Cron, CronInput, CronPatch } from "./cron-types";
import { useBoardEvents } from "./use-events";

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

  const put = (cron: Cron) => setCrons((list) => (list.some((c) => c.id === cron.id) ? list.map((c) => (c.id === cron.id ? cron : c)) : [...list, cron]));
  return {
    crons,
    error,
    create: async (input: CronInput) => {
      const cron = await cronApi.create(input);
      put(cron);
      return cron;
    },
    // The change shows at once (a switch flips the moment you click it); a refusal reloads what the server has.
    update: async (id: string, patch: CronPatch) => {
      setCrons((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      try {
        put(await cronApi.update(id, patch));
      } catch (err) {
        void reload();
        throw err;
      }
    },
    remove: async (id: string) => {
      await cronApi.remove(id);
      setCrons((list) => list.filter((c) => c.id !== id));
    },
    run: (id: string) => cronApi.run(id),
  };
}

export type CronsState = ReturnType<typeof useCrons>;

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./client";
import { DEFAULT_REFRESH_MS, servicesRefreshMs, subscribeServicesRefresh } from "./services-prefs";
import type { DevLauncher, MachineInfo, ServiceEntry } from "./types";
import type { WorkerDevGroup } from "./worker-dev-list";

// While the drawer is closed the list is only asked for now and then, for the rail's count.
export const IDLE_POLL_MS = 30_000;

// Every process Weft spawned (GET /api/services), grouped by what started it. Loaded when the board
// starts, on focus, and on a timer: the user's refresh rate while the drawer is open (lib/services-prefs.ts).
export function useServices(active = false) {
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [launchers, setLaunchers] = useState<DevLauncher[]>([]);
  const [workers, setWorkers] = useState<WorkerDevGroup[]>([]);
  const [machine, setMachine] = useState<MachineInfo | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshMs = useSyncExternalStore(subscribeServicesRefresh, servicesRefreshMs, () => DEFAULT_REFRESH_MS);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const answer = await api.services();
      if (mine !== latest.current) return;
      setServices(answer.services);
      setLaunchers(answer.launchers ?? []);
      setWorkers(answer.workers ?? []);
      setMachine(answer.machine);
      setLoaded(true);
      setError(null);
    } catch (err) {
      if (mine === latest.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const load = () => void reload();
    load();
    window.addEventListener("focus", load);
    const every = active ? refreshMs : IDLE_POLL_MS;
    const poll = every ? setInterval(load, every) : undefined;
    return () => {
      window.removeEventListener("focus", load);
      clearInterval(poll);
    };
  }, [reload, active, refreshMs]);

  // End a service or one of its processes, or start a dev server again; the list reloads right after.
  const kill = async (target: { id: string } | { pid: number }) => {
    await api.serviceAction({ action: "kill", ...target });
    await reload();
  };
  const restart = async (id: string) => {
    await api.serviceAction({ action: "restart", id });
    await reload();
  };

  // Start a working folder's dev command, or restart the run serving it: answers "started" or "restarted".
  const launch = async (cwd: string, command: string) => {
    const { result } = await api.launchDev(cwd, command);
    await reload();
    return result;
  };

  return { services, launchers, workers, machine, loaded, error, reload, kill, restart, launch, refreshMs };
}

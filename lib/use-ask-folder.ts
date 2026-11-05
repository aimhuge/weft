"use client";

// The folder an in-thread ask_add (components/SecretAskInput.tsx) puts its value in. On this Mac, the ask's own: the
// card's folder. A worker card's ask names the worker's checkout, which means nothing to this Mac's vault, so the open
// card says it's a worker project (AskProjectContext, from components/OpenCard.tsx) and the value goes into the vault of
// this Mac's twin of it, the checkout of the same repo (lib/worker-twin-mac.ts), the one the worker's ask_add already
// put the blank in (electron/worker-vault.cjs). The value never goes through the worker.
import { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { parseWorkerProject } from "./worker-project";

// The open card's project when it runs on a worker; null on this Mac.
export const AskProjectContext = createContext<string | null>(null);

// The worker project's twin on this Mac, or null when this Mac has no checkout of it.
export async function askTwin(project: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/worker-board?${new URLSearchParams({ twin: project }).toString()}`);
    if (!res.ok) return null;
    const { folder } = (await res.json()) as { folder?: unknown };
    return typeof folder === "string" && folder ? folder : null;
  } catch {
    return null;
  }
}

/** The ask's folder on this Mac: undefined while a worker project's twin is looked up, null when it has none. */
export function useAskFolder(folder: string): string | null | undefined {
  const context = useContext(AskProjectContext);
  const project = context && parseWorkerProject(context) ? context : null;
  const [twin, setTwin] = useState<{ project: string; folder: string | null } | null>(null);
  useEffect(() => {
    if (!project) return;
    let on = true;
    void askTwin(project).then((found) => on && setTwin({ project, folder: found }));
    return () => {
      on = false;
    };
  }, [project]);
  if (!project) return folder;
  return twin?.project === project ? twin.folder : undefined;
}

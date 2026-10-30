"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { waitForCommand, type CommandResult } from "./worker-command-wait";
import type { WorkersView } from "./workers-account";

// The Workers card on Settings → Sync (components/WorkerSettings.tsx): the workspace's Weft Workers through
// /api/workers, read when the page opens and every 10 s while it's open, so a box that just enrolled turns up.

const POLL_MS = 10_000;

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const load = async () => readJson<WorkersView>(await apiFetch("/api/workers"));
const post = async <T>(body: object) => readJson<T>(await apiFetch("/api/workers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

// Sends a command and waits for how it went, so its real result reaches the board. A failure throws its message.
async function sendAndWait(body: object): Promise<CommandResult> {
  const { commandId } = await post<{ commandId: string }>(body);
  const result = await waitForCommand(async () => readJson<CommandResult>(await apiFetch(`/api/workers?command=${encodeURIComponent(commandId)}`)));
  if (result.status === "failed") throw new Error(result.error ?? "The worker couldn't do that.");
  return result;
}

export function useWorkers() {
  const [view, setView] = useState<WorkersView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      load().then(
        (v) => {
          setView(v);
          setError(null);
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      ),
    [],
  );

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const token = useCallback(() => post<{ token: string; command: string }>({ action: "token" }), []);
  const run = useCallback((body: { workerId: string; folder: string; prompt: string; repo?: string }) => post<{ commandId: string }>({ action: "run", ...body }), []);
  const login = useCallback((workerId: string, token: string) => post<{ commandId: string }>({ action: "login", workerId, token }), []);
  const github = useCallback((workerId: string, token: string) => sendAndWait({ action: "github", workerId, token }).finally(() => void reload()), [reload]);
  const clone = useCallback((workerId: string, repo: string) => sendAndWait({ action: "clone", workerId, repo }), []);
  const remove = useCallback(
    async (id: string) => {
      await readJson(await apiFetch(`/api/workers?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
      await reload();
    },
    [reload],
  );

  return { view, error, token, run, login, github, clone, remove };
}

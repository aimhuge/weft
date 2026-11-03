"use client";

// Settings → Devices → a paired worker's Secrets (components/WorkerKeep.tsx, docs/architecture/secrets.md#kept-on-a-worker):
// what this Mac keeps on the worker, names only, and "Keep on this worker" for a project's development or preview set.
// Everything goes through window.weft.workerKeep to Electron main (electron/worker-keep.cjs), which asks Touch ID before
// it sends a value and signs every command with this Mac's key. No value ever reaches the board.
import { useCallback, useEffect, useState } from "react";

export interface KeptView {
  repo: string;
  label: string;
  environment: string;
  names: string[];
}

export interface KeepList {
  kept: KeptView[];
  repos: { id: string; label: string }[];
  environments: string[];
}

export type KeepResult = { kept: string[]; label: string } | { denied: true; label: string } | { none: true; label: string };

export interface WorkerKeepBridge {
  list(worker: string): Promise<KeepList>;
  keep(request: { worker: string; repo: string; environment: string }): Promise<KeepResult>;
  stop(request: { worker: string; repo: string; environment: string }): Promise<{ sent: boolean; name: string }>;
  wipe(worker: string): Promise<{ sent: boolean; name: string }>;
}

export const workerKeepBridge = (): WorkerKeepBridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { workerKeep?: WorkerKeepBridge } }).weft?.workerKeep;

export function keepOutcome(name: string, environment: string, r: KeepResult): string {
  if ("denied" in r) return "Not approved, so nothing was sent.";
  if ("none" in r) return `${r.label} has no ${environment} values to keep.`;
  const count = r.kept.length === 1 ? "1 secret" : `${r.kept.length} secrets`;
  return `Sent ${count} of ${r.label} (${environment}) to ${name}. Each use still asks you here.`;
}

// An IPC error as the user should read it, without Electron's "Error invoking remote method" prefix.
export const plainError = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));

export function useWorkerKeep(worker: string, name: string, bridge: WorkerKeepBridge | undefined = workerKeepBridge()) {
  const [list, setList] = useState<KeepList | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bridge) return;
    try {
      setList(await bridge.list(worker));
    } catch (err) {
      setError(plainError(err));
    }
  }, [bridge, worker]);

  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    return () => clearTimeout(first);
  }, [reload]);

  const act = async (fn: (b: WorkerKeepBridge) => Promise<string>) => {
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await fn(bridge));
      await reload();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    available: Boolean(bridge),
    list,
    note,
    error,
    busy,
    keep: (repo: string, environment: string) => act(async (b) => keepOutcome(name, environment, await b.keep({ worker, repo, environment }))),
    stop: (repo: string, environment: string) =>
      act(async (b) => ((await b.stop({ worker, repo, environment })).sent ? `${name} will delete its copy as soon as it takes the command.` : "Forgotten here; that worker was revoked.")),
    wipe: () => act(async (b) => ((await b.wipe(worker)).sent ? `${name} will delete everything this Mac kept there.` : "Forgotten here; that worker was revoked.")),
  };
}

"use client";

// Settings → Devices → a worker → Connectors (components/WorkerConnectors.tsx,
// docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built): your connectors per worker through
// /api/devices/connectors, Connect GitHub in the browser pane, and the changes. Turning GitHub on, a looser setting and
// an Allow go through main (window.weft.connectors), which asks Touch ID; turning it off goes through the route, which
// has weft.zip end the worker's tokens at GitHub and says what GitHub confirmed.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api-client";
import type { GrantSettings } from "./connector-grant";
import type { ConnectorsView, PendingAllow } from "./connector-view";
import { openInPane } from "./open-in-pane";

export interface ConnectorsBridge {
  set(workerId: string, workerName: string, connector: "github", settings: GrantSettings): Promise<{ ok?: boolean; denied?: boolean }>;
  allow(grantId: string, workerName: string, kind: PendingAllow["kind"], subject: string, label: string): Promise<{ ok?: boolean; denied?: boolean }>;
}

export const connectorsBridge = (): ConnectorsBridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { connectors?: ConnectorsBridge } }).weft?.connectors;

const RELOAD_MS = 30_000;

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function useWorkerConnectors(bridge: ConnectorsBridge | undefined = connectorsBridge()) {
  const [view, setView] = useState<ConnectorsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await readJson<ConnectorsView>(await apiFetch("/api/devices/connectors"));
      if (live.current) setView(next);
    } catch (err) {
      if (live.current) setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), RELOAD_MS);
    return () => {
      live.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [reload]);

  const act = useCallback(
    async (fn: () => Promise<string | null>) => {
      setError(null);
      try {
        const said = await fn();
        if (live.current) setNote(said);
        await reload();
      } catch (err) {
        if (live.current) setError((err as Error).message);
      }
    },
    [reload],
  );

  const denied = (r: { denied?: boolean }, what: string) => (r.denied ? `Not changed: ${what} needs Touch ID.` : null);

  return {
    view,
    error,
    note,
    canChange: Boolean(bridge),
    reload,
    connect: () => {
      if (view) openInPane(view.connectUrl);
      setNote("Connect GitHub in the browser pane, then come back here.");
    },
    set: (workerId: string, workerName: string, settings: GrantSettings) =>
      act(async () => {
        if (!bridge) throw new Error("Turn connectors on from Weft's own window.");
        return denied(await bridge.set(workerId, workerName, "github", settings), "that");
      }),
    allow: (workerName: string, grantId: string, p: PendingAllow) =>
      act(async () => {
        if (!bridge) throw new Error("Allow from Weft's own window.");
        return denied(await bridge.allow(grantId, workerName, p.kind, p.subject, p.label), "an Allow");
      }),
    off: (workerId: string, workerName: string) =>
      act(async () => {
        const r = await readJson<{ note?: string }>(await apiFetch(`/api/devices/connectors?worker=${encodeURIComponent(workerId)}`, { method: "DELETE" }));
        return `${workerName}: ${r.note ?? "GitHub off"}`;
      }),
    disconnect: () =>
      act(async () => {
        const r = await readJson<{ grants: number; authorization: string }>(await apiFetch("/api/devices/connectors?all=1", { method: "DELETE" }));
        return r.authorization === "deleted" ? "GitHub disconnected: GitHub confirmed Weft's authorization is gone." : "GitHub disconnected here; GitHub didn't confirm, so remove Weft at github.com/settings/apps/authorizations.";
      }),
  };
}

export type WorkerConnectors = ReturnType<typeof useWorkerConnectors>;

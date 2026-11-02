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

// A Mac key of yours that may approve connectors (lib/connector-signers.ts SignerView).
export interface MacKey {
  id: string;
  key: string;
  name: string;
  addedAt: string;
  trustedFrom: string;
  trusted: boolean;
}

export interface ConnectorsBridge {
  set(workerId: string, workerName: string, connector: "github", settings: GrantSettings): Promise<{ ok?: boolean; denied?: boolean; waitingUntil?: string | null }>;
  allow(grantId: string, workerName: string, kind: PendingAllow["kind"], subject: string, label: string): Promise<{ ok?: boolean; denied?: boolean }>;
  signers?(): Promise<{ mine: string; signers: MacKey[] }>;
  trust?(key: string, name: string): Promise<{ ok?: boolean; denied?: boolean }>;
  forgetSigner?(id: string): Promise<unknown>;
}

// What a grant written by a key still waiting out its day says.
export const waitingNote = (until: string | null | undefined) =>
  until ? ` It works from ${new Date(until).toLocaleString()}, when this Mac's key is trusted, or sooner if a trusted Mac vouches for it.` : "";

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
  const [macs, setMacs] = useState<{ mine: string; signers: MacKey[] } | null>(null);
  const live = useRef(true);

  // The view every 30 seconds; the Mac keys only on the first read and after a change, since each read is a call to weft.zip.
  const reload = useCallback(async (withMacs = false) => {
    try {
      const next = await readJson<ConnectorsView>(await apiFetch("/api/devices/connectors"));
      if (live.current) setView(next);
      // This Mac's key and the others, from main (which registers this one the first time).
      if (withMacs && next.signedIn && bridge?.signers) {
        const keys = await bridge.signers().catch(() => null);
        if (live.current && keys) setMacs(keys);
      }
    } catch (err) {
      if (live.current) setError((err as Error).message);
    }
  }, [bridge]);

  useEffect(() => {
    live.current = true;
    const first = setTimeout(() => void reload(true), 0);
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
        await reload(true);
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
    macs,
    canChange: Boolean(bridge),
    reload,
    connect: () => {
      if (view) openInPane(view.connectUrl);
      setNote("Connect GitHub in the browser pane, then come back here.");
    },
    set: (workerId: string, workerName: string, settings: GrantSettings) =>
      act(async () => {
        if (!bridge) throw new Error("Turn connectors on from Weft's own window.");
        const r = await bridge.set(workerId, workerName, "github", settings);
        return denied(r, "that") ?? (r.waitingUntil ? `${workerName}: saved.${waitingNote(r.waitingUntil)}` : null);
      }),
    trust: (mac: MacKey) =>
      act(async () => {
        if (!bridge?.trust) throw new Error("Vouch for a Mac from Weft's own window.");
        return denied(await bridge.trust(mac.key, mac.name), "vouching for a Mac") ?? `${mac.name} can approve connectors now.`;
      }),
    forgetMac: (mac: MacKey) =>
      act(async () => {
        if (!bridge?.forgetSigner) throw new Error("Remove a Mac key from Weft's own window.");
        await bridge.forgetSigner(mac.id);
        return `${mac.name} can't approve connectors anymore; the grants it made are off.`;
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

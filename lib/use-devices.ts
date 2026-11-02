"use client";

// Settings → Devices (components/DevicesSettings.tsx, docs/architecture/device-registry.md): every device of yours from
// the one registry through /api/devices, Revoke for any kind, and Add a worker, which pairs a box over
// window.weft.hostPairing the way a phone pairs (the code's secret, the claim check and Touch ID stay in main).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api-client";
import type { DeviceView, DevicesView } from "./device-registry";
import { pairingBridge, type PairingBridge } from "./use-pairing";

export const POLL_MS = 2_000;
const RELOAD_MS = 15_000;

export interface WorkerCode {
  id: string;
  code: string;
  command: string;
  expiresAt: number;
}

type WorkerCheck = { status: "open" | "paired" | "cancelled" | "expired" | "failed"; error?: string; worker?: { name: string; code: string } };

export interface HostPairingBridge {
  start(orgId?: string): Promise<WorkerCode>;
  check(id: string): Promise<WorkerCheck>;
  cancel(id: string): Promise<void>;
  // Re-pin: forget the keys main pinned for a worker's secrets, after Touch ID (electron/worker-pins.cjs).
  forgetPin?: (id: string, name: string) => Promise<{ forgotten?: boolean; denied?: boolean }>;
}

export function repinOutcome(name: string, r: { forgotten?: boolean; denied?: boolean }): string {
  if (r.denied) return "Not re-pinned.";
  return r.forgotten ? `Forgot ${name}'s pinned keys: its next secret ask pins the keys it has now.` : `${name} had no pinned keys on this Mac.`;
}

export const hostPairingBridge = (): HostPairingBridge | undefined =>
  (window as unknown as { weft?: { hostPairing?: HostPairingBridge } }).weft?.hostPairing;

// A phone or browser this Mac pinned goes through main, which also unpins it and rotates the workspace key; anything
// else (a worker, a Mac, a phone another Mac paired) through device_revoke.
export function revokeRoute(device: Pick<DeviceView, "id" | "kind">, pinned: ReadonlySet<string>): "pairing" | "registry" {
  return (device.kind === "phone" || device.kind === "browser") && pinned.has(device.id) ? "pairing" : "registry";
}

export function workerOutcome(r: WorkerCheck): string {
  if (r.status === "paired") return `Added ${r.worker?.name ?? "the worker"}.`;
  if (r.status === "expired") return "The code expired. Make a new one.";
  if (r.status === "failed") return `Not added: ${r.error ?? "the claim didn't check out"}`;
  return "Not added.";
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

interface Bridges {
  pairing?: PairingBridge;
  hosts?: HostPairingBridge;
}

export const bridgesHere = (): Bridges => (typeof window === "undefined" ? {} : { pairing: pairingBridge(), hosts: hostPairingBridge() });

export function useDevices({ pairing, hosts }: Bridges = bridgesHere()) {
  const [view, setView] = useState<DevicesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<WorkerCode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await readJson<DevicesView>(await apiFetch("/api/devices"));
      if (!live.current) return;
      setView(next);
      setError(null);
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err));
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

  const act = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // While a worker's code is open, ask main whether the box claimed it (main checks it and asks Touch ID in there).
  useEffect(() => {
    if (!hosts || !code) return;
    const timer = setInterval(() => {
      void act(async () => {
        const r = await hosts.check(code.id);
        if (r.status === "open" || !live.current) return;
        setCode(null);
        setNote(workerOutcome(r));
        if (r.status === "paired") await reload();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [act, code, hosts, reload]);

  const revoke = (device: DeviceView) =>
    act(async () => {
      const pinned = new Set((await pairing?.list())?.map((d) => d.id) ?? []);
      if (revokeRoute(device, pinned) === "pairing") await pairing?.revoke(device.id);
      else await readJson(await apiFetch(`/api/devices?id=${encodeURIComponent(device.id)}`, { method: "DELETE" }));
      await reload();
    });

  const repin = (device: DeviceView) =>
    act(async () => {
      const r = await hosts?.forgetPin?.(device.id, device.name);
      if (r && live.current) setNote(repinOutcome(device.name, r));
    });

  return {
    view,
    error,
    code,
    note,
    canAddWorker: Boolean(hosts),
    canRepin: Boolean(hosts?.forgetPin),
    revoke,
    repin,
    addWorker: () =>
      act(async () => {
        setNote(null);
        if (hosts) setCode(await hosts.start());
      }),
    cancelWorker: () =>
      act(async () => {
        if (hosts && code) await hosts.cancel(code.id);
        setCode(null);
      }),
  };
}

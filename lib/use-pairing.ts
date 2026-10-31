"use client";

// Settings → Sync's Pair a phone card (components/PairDevices.tsx, docs/architecture/mobile-security.md): the paired
// devices and the two switches from Electron main, and one pairing code at a time, polled until the device claims it
// (main checks the claim and asks Touch ID inside that poll). Everything goes over window.weft.pairing; the code's
// secret and every key stay in main.
import { useCallback, useEffect, useRef, useState } from "react";

export interface PairedDeviceView {
  id: string;
  name: string;
  kind: "phone" | "browser";
  platform: string;
  fingerprint: string;
  pairedAt: string;
}

export interface PairingSettings {
  seal: boolean;
  webApprovals: boolean;
}

export interface PairingCode {
  id: string;
  link: string;
  expiresAt: number;
}

type CheckResult = { status: "open" | "paired" | "cancelled" | "expired" | "failed"; error?: string; device?: PairedDeviceView };

export interface PairingBridge {
  start(orgId?: string): Promise<PairingCode>;
  check(id: string): Promise<CheckResult>;
  cancel(id: string): Promise<void>;
  list(): Promise<PairedDeviceView[]>;
  revoke(id: string): Promise<{ ok: boolean }>;
  settings(): Promise<PairingSettings>;
  setSettings(change: Partial<PairingSettings>): Promise<PairingSettings>;
}

export const POLL_MS = 1500;

export const pairingBridge = (): PairingBridge | undefined => (window as unknown as { weft?: { pairing?: PairingBridge } }).weft?.pairing;

// What a finished code says on the card.
export function outcomeText(r: CheckResult): string {
  if (r.status === "paired") return `Paired ${r.device?.name ?? "the device"}.`;
  if (r.status === "expired") return "The code expired. Make a new one.";
  if (r.status === "failed") return `Not paired: ${r.error ?? "the claim didn't check out"}`;
  return "Not paired.";
}

export function usePairing(bridge: PairingBridge | undefined = typeof window === "undefined" ? undefined : pairingBridge()) {
  const [devices, setDevices] = useState<PairedDeviceView[]>([]);
  const [settings, setSettingsState] = useState<PairingSettings>({ seal: false, webApprovals: false });
  const [code, setCode] = useState<PairingCode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (live.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const [list, s] = await Promise.all([bridge.list(), bridge.settings()]);
    if (!live.current) return;
    setDevices(list);
    setSettingsState(s);
  }, [bridge]);

  useEffect(() => {
    live.current = true;
    // Deferred a tick so the effect itself sets no state (react-hooks/set-state-in-effect).
    const first = setTimeout(() => void run(refresh), 0);
    return () => {
      clearTimeout(first);
      live.current = false;
    };
  }, [refresh, run]);

  // While a code is open, ask main every POLL_MS whether it was claimed.
  useEffect(() => {
    if (!bridge || !code) return;
    const timer = setInterval(() => {
      void run(async () => {
        const r = await bridge.check(code.id);
        if (r.status === "open" || !live.current) return;
        setCode(null);
        setNote(outcomeText(r));
        if (r.status === "paired") await refresh();
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [bridge, code, refresh, run]);

  return {
    available: Boolean(bridge),
    devices,
    settings,
    code,
    note,
    error,
    start: () =>
      run(async () => {
        setNote(null);
        if (bridge) setCode(await bridge.start());
      }),
    cancel: () =>
      run(async () => {
        if (bridge && code) await bridge.cancel(code.id);
        setCode(null);
      }),
    revoke: (id: string) =>
      run(async () => {
        await bridge?.revoke(id);
        await refresh();
      }),
    setSetting: (change: Partial<PairingSettings>) =>
      run(async () => {
        if (bridge) setSettingsState(await bridge.setSettings(change));
      }),
  };
}

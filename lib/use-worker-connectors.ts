"use client";

// Connectors lent to a paired worker, on Settings → Devices (components/WorkerConnectors.tsx,
// docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built). Main holds the choice and asks
// Touch ID to turn one on (electron/worker-connectors.cjs); this lists what's on, toggles it, and reads the Google
// accounts gog has on this Mac to offer.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { GogStatus } from "./gog-view";
import { hostPairingBridge } from "./use-devices";

export type Connector = "gog" | "gh";

export interface Lent {
  workerId: string;
  connector: Connector;
  account: string;
  since: string;
}

export interface ConnectorsBridge {
  list(): Promise<Lent[]>;
  enable(workerId: string, connector: Connector, account?: string): Promise<{ enabled?: boolean; denied?: boolean; account?: string }>;
  disable(workerId: string, connector: Connector): Promise<{ disabled?: boolean; note?: string }>;
}

export const CONNECTOR_LABEL: Record<Connector, string> = { gog: "Google", gh: "GitHub" };

export const connectorsBridge = (): ConnectorsBridge | undefined => (typeof window === "undefined" ? undefined : (hostPairingBridge() as { connectors?: ConnectorsBridge } | undefined)?.connectors);

// What the row says after a toggle.
export function toggleOutcome(name: string, connector: Connector, r: { enabled?: boolean; denied?: boolean; account?: string; disabled?: boolean; note?: string }): string {
  const label = CONNECTOR_LABEL[connector];
  if (r.denied) return `${label} wasn't lent to ${name}.`;
  if (r.enabled) return `${name}'s cards can use ${label} as ${r.account ?? "you"}.`;
  return r.note ? `${label} is off for ${name}. ${r.note}` : `${label} is off for ${name}; it forgets the token.`;
}

export async function googleAccounts(): Promise<string[]> {
  const res = await apiFetch("/api/connectors/gog");
  const status = (await res.json().catch(() => ({ installed: false }))) as GogStatus;
  return res.ok && status.installed ? status.accounts.map((a) => a.email) : [];
}

export function useWorkerConnectors(bridge: ConnectorsBridge | undefined = connectorsBridge()) {
  const [lent, setLent] = useState<Lent[]>([]);
  const [google, setGoogle] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async (from: ConnectorsBridge) => setLent(await from.list()), []);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.list().then(
      (list) => live && setLent(list),
      () => undefined,
    );
    void googleAccounts().then(
      (emails) => live && setGoogle(emails),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [bridge]);

  const isOn = (workerId: string, connector: Connector) => lent.find((l) => l.workerId === workerId && l.connector === connector);

  const toggle = async (workerId: string, name: string, connector: Connector, account?: string) => {
    if (!bridge) return;
    setNote(null);
    try {
      const r = isOn(workerId, connector) ? await bridge.disable(workerId, connector) : await bridge.enable(workerId, connector, account);
      setNote(toggleOutcome(name, connector, r));
      await reload(bridge);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };

  return { available: Boolean(bridge), lent, google, note, isOn, toggle };
}

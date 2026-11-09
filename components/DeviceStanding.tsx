"use client";

import { useCallback, useEffect, useState } from "react";
import { deviceBridge, type DeviceBridge, type DeviceStanding } from "@/lib/vault-view";

// This Mac's standing with the account, said where it stops something (docs/architecture/device-registry.md,
// "Re-adding a Mac"): removed (revoked) gets Re-add, a failed registration gets Try again with the reason. The 🔐
// drawer shows it as the vault's why-line (lib/vault-status.ts, components/VaultShared.tsx JoinHint); Settings →
// Devices as a line above the list.

const LINE = "text-[12px] leading-snug text-warn";
const LINK = "text-accent hover:underline disabled:opacity-50";
const TEXT = {
  revoked: "This Mac was removed from your account, so it can't share or join a vault.",
  unregistered: "This Mac couldn't register with your account, so it can't share or join a vault.",
};

// Runs Re-add or Try again. onDone: load again; notify: say why it failed.
async function fix(devices: DeviceBridge, state: "revoked" | "unregistered") {
  if (state === "unregistered") return Boolean(await devices.register?.());
  const result = await devices.readd?.();
  return !result?.denied;
}

export function DeviceStandingLine({ state, error, devices = deviceBridge(), onDone, notify }: { state: "revoked" | "unregistered"; error?: string; devices?: DeviceBridge | null; onDone: () => void; notify: (err: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!devices) return;
    setBusy(true);
    try {
      if (await fix(devices, state)) onDone();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className={LINE} title={error}>
      {TEXT[state]}
      {state === "unregistered" && error ? <span className="text-muted"> {error}</span> : null}{" "}
      {(state === "revoked" ? devices?.readd : devices?.register) ? (
        <button type="button" disabled={busy} onClick={() => void run()} className={LINK} title={state === "revoked" ? "Makes this Mac a new key (the removed one stays distrusted) and adds it to your account again, after Touch ID" : undefined}>
          {busy ? "Working…" : state === "revoked" ? "Re-add it" : "Try again"}
        </button>
      ) : null}
    </p>
  );
}

// Settings → Devices' line for this Mac: only when it was removed or couldn't register.
export function ThisMacStanding({ onDone, notify }: { onDone: () => void; notify: (err: unknown) => void }) {
  const [standing, setStanding] = useState<DeviceStanding | null>(null);
  const load = useCallback(() => {
    void deviceBridge()
      ?.standing?.()
      .then(setStanding)
      .catch(() => setStanding(null));
  }, []);
  useEffect(load, [load]);
  if (standing?.state !== "revoked" && standing?.state !== "unregistered") return null;
  const done = () => {
    load();
    onDone();
  };
  return <DeviceStandingLine state={standing.state} error={standing.error} onDone={done} notify={notify} />;
}

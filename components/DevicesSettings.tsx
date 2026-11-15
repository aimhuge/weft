"use client";

// Settings → Devices (docs/architecture/device-registry.md): every Mac, worker, phone and browser of yours in one list,
// from the one registry, each with the keys it holds and a Revoke that works whatever its kind. Add a worker pairs a box
// the way a phone pairs: run the line on it, then confirm with Touch ID here when the codes match.
import { newestVersion } from "@/lib/device-version";
import { machinesOf } from "@/lib/machines";
import { useDevices } from "@/lib/use-devices";
import { useNow } from "@/lib/use-now";
import { useState } from "react";
import { Spinner } from "./Icon";
import { ThisMacStanding } from "./DeviceStanding";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";
import { BUTTON, MachineRow, RevokedRow, SUBTLE, type Open } from "./MachineRow";

function AddWorker({ devices }: { devices: ReturnType<typeof useDevices> }) {
  const { code, canAddWorker, addWorker, cancelWorker } = devices;
  if (!canAddWorker) return null;
  if (!code)
    return (
      <button type="button" className={`shrink-0 ${BUTTON}`} onClick={() => void addWorker()}>
        Add a worker
      </button>
    );
  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      <p className="text-[13px] text-ink">
        Run this on the box. When it prints a code, Touch ID here will name the same one.
        {code.fingerprint && <span className="text-muted"> Moving a paired worker here? Its old Mac&apos;s Re-pair will name this Mac as {code.fingerprint}.</span>}
      </p>
      <code className="block select-all break-all rounded-md bg-sunken px-2 py-1 font-mono text-[12px] text-ink">{code.command}</code>
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-2 ${SUBTLE}`}>
          <Spinner size={11} /> Waiting for the box
        </span>
        <button type="button" className={BUTTON} onClick={() => void navigator.clipboard.writeText(code.command)}>
          Copy
        </button>
        <button type="button" className={BUTTON} onClick={() => void cancelWorker()}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function DevicesSettings() {
  const devices = useDevices();
  const now = useNow();
  const [open, setOpen] = useState<Open | null>(null);
  // Re-add or Try again failing for this Mac (components/DeviceStanding.tsx).
  const [fixError, setFixError] = useState<string | null>(null);
  const list = devices.view?.devices ?? [];
  const newest = newestVersion(list.filter((d) => !d.revokedAt).map((d) => d.build));
  const machines = machinesOf(list);
  const shown = machines.filter((m) => m.mac || m.worker || m.others.length);
  const revoked = machines.flatMap((m) => m.revoked);
  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SettingsSectionHeader title="Your devices" hint="Each Mac, worker, phone and browser that can reach your account, one line per machine. Revoke or Forget one and its keys stop working." />
        <AddWorker devices={devices} />
      </div>
      {devices.view && !devices.view.signedIn && <p className={`mt-3 ${SUBTLE}`}>Sign in to Weft to see your devices.</p>}
      {devices.note && <p className="mt-3 text-[12.5px] text-ink">{devices.note}</p>}
      {devices.error && <p className="mt-3 text-[12.5px] text-danger">{devices.error}</p>}
      <div className="mt-3 empty:hidden">
        <ThisMacStanding onDone={() => setFixError(null)} notify={(err) => setFixError(err instanceof Error ? err.message : String(err))} />
      </div>
      {fixError && <p className="mt-2 text-[12.5px] text-danger">{fixError}</p>}
      {shown.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {shown.map((m) => (
            <MachineRow key={m.key} m={m} list={list} devices={devices} now={now} newest={newest} open={open} setOpen={setOpen} />
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <details className="mt-3">
          <summary className={`cursor-pointer ${SUBTLE}`}>Revoked ({revoked.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {revoked.map((d) => (
              <RevokedRow key={d.id} d={d} list={list} devices={devices} now={now} open={open} setOpen={setOpen} />
            ))}
          </ul>
        </details>
      )}
    </SettingsCard>
  );
}

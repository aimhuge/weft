"use client";

// Settings → Devices (docs/architecture/device-registry.md): every Mac, worker, phone and browser of yours in one list,
// from the one registry, each with the keys it holds and a Revoke that works whatever its kind. Add a worker pairs a box
// the way a phone pairs: run the line on it, then confirm with Touch ID here when the codes match.
import type { DeviceKind, DeviceView } from "@/lib/device-registry";
import { newestVersion, versionText } from "@/lib/device-version";
import { timeAgo } from "@/lib/format";
import { useDevices } from "@/lib/use-devices";
import { useNow } from "@/lib/use-now";
import { useState } from "react";
import { useWorkerConnectors } from "@/lib/use-worker-connectors";
import WorkerConnectors from "./WorkerConnectors";
import { Spinner } from "./Icon";
import { WorkerRepair } from "./WorkerRepair";
import { WorkerKeep } from "./WorkerKeep";
import { workerKeepBridge } from "@/lib/use-worker-keep";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
const KIND: Record<DeviceKind, string> = { mac: "Mac", worker: "Worker", phone: "Phone", browser: "Browser" };

// What it can do, from the keys it holds: the one line under its name.
function holdsLine(d: DeviceView): string {
  const parts = [KIND[d.kind]];
  if (d.approves) parts.push(d.kind === "browser" ? "approves with a passkey" : "approves with Face ID");
  else if (d.hasBoxKey && d.kind !== "worker") parts.push("reads sealed threads");
  if (d.kind === "worker") parts.push(d.hasSignKey ? "paired" : "enrolled by token");
  if (d.here) parts.push("this Mac");
  return parts.join(" · ");
}

// The status, then the Weft version and commit it runs when it reports one.
function seenLine(d: DeviceView, now: number, newest: string | null): string {
  const v = versionText(d.build, newest);
  return v ? `${statusLine(d, now)} · ${v}` : statusLine(d, now);
}

function statusLine(d: DeviceView, now: number): string {
  if (d.revokedAt) return `Revoked ${timeAgo(Date.parse(d.revokedAt), now)}`;
  if (d.status === "online" || d.status === "busy") return d.status === "busy" ? "Busy" : "Online";
  return d.lastSeenAt ? `Seen ${timeAgo(Date.parse(d.lastSeenAt), now)}` : "Never seen";
}

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

// A live device's buttons: a worker's connectors, kept secrets, re-pin, passkeys and re-pair, and Revoke for every kind.
function DeviceActions({ d, devices, connectors, now, onRepair, onKeep }: { d: DeviceView; devices: ReturnType<typeof useDevices>; connectors: ReturnType<typeof useWorkerConnectors>; now: number; onRepair: () => void; onKeep: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {d.kind === "worker" && d.hasSignKey && <WorkerConnectors c={connectors} workerId={d.id} name={d.name} now={now} />}
      {d.kind === "worker" && d.hasSignKey && workerKeepBridge() && (
        <button type="button" className={BUTTON} onClick={onKeep} aria-label={`Secrets kept on ${d.name}`} title="Keep a project's development or preview secrets on this worker (off unless you turn it on; each use still asks Touch ID here)">
          Secrets
        </button>
      )}
      {d.kind === "worker" && devices.canRepin && (
        <button type="button" className={BUTTON} onClick={() => void devices.repin(d)} aria-label={`Re-pin ${d.name}`} title="Forget the keys this Mac pinned for this worker's secrets, after Touch ID; its next ask pins new ones">
          Re-pin
        </button>
      )}
      {d.kind === "worker" && devices.canTrustPasskeys && (
        <button type="button" className={BUTTON} onClick={() => void devices.trustPasskeys(d)} aria-label={`Passkeys on ${d.name}`} title="Let your paired passkeys approve folder, agent, shell and terminal changes on this worker from the web, after Touch ID">
          Passkeys
        </button>
      )}
      {d.kind === "worker" && d.hasSignKey && devices.canRepair && (
        <button type="button" className={BUTTON} onClick={onRepair} aria-label={`Re-pair ${d.name}`} title="Let this worker trust another Mac instead of this one: paste that Mac's code, Touch ID, and run the line it shows on the box">
          Re-pair
        </button>
      )}
      <button type="button" className={BUTTON} onClick={() => void devices.revoke(d)} aria-label={`Revoke ${d.name}`}>
        Revoke
      </button>
    </div>
  );
}

export default function DevicesSettings() {
  const devices = useDevices();
  const connectors = useWorkerConnectors();
  const now = useNow();
  const [repairing, setRepairing] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const list = devices.view?.devices ?? [];
  const newest = newestVersion(list.filter((d) => !d.revokedAt).map((d) => d.build));
  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SettingsSectionHeader title="Your devices" hint="Every Mac, worker, phone and browser that holds a key of yours. Revoke one and its keys stop working." />
        <AddWorker devices={devices} />
      </div>
      {devices.view && !devices.view.signedIn && <p className={`mt-3 ${SUBTLE}`}>Sign in to Weft to see your devices.</p>}
      {devices.note && <p className="mt-3 text-[12.5px] text-ink">{devices.note}</p>}
      {devices.error && <p className="mt-3 text-[12.5px] text-danger">{devices.error}</p>}
      {list.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {list.map((d) => (
            <li key={d.id} className={`flex flex-wrap items-center justify-between gap-x-3 ${d.revokedAt ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{d.name}</div>
                <div className={SUBTLE}>
                  {holdsLine(d)} · {seenLine(d, now, newest)}
                  {devices.untaken.includes(d.id) && <span className="text-warn" title="This Mac changed which passkeys this worker trusts, and the worker hasn't confirmed it yet: until it does, a passkey you revoked may still approve there. Weft keeps sending it."> · passkeys not updated yet</span>}
                </div>
                {d.note && !d.revokedAt && <div className="text-[12.5px] text-warn">{d.note}</div>}
              </div>
              {!d.revokedAt && <DeviceActions d={d} devices={devices} connectors={connectors} now={now} onRepair={() => setRepairing(repairing === d.id ? null : d.id)} onKeep={() => setKeeping(keeping === d.id ? null : d.id)} />}
              {repairing === d.id && <WorkerRepair device={d} onClose={() => setRepairing(null)} />}
              {keeping === d.id && <WorkerKeep device={d} onClose={() => setKeeping(null)} />}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

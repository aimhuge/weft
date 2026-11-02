"use client";

// Settings → Devices (docs/architecture/device-registry.md): every Mac, worker, phone and browser of yours in one list,
// from the one registry, each with the keys it holds and a Revoke that works whatever its kind. Add a worker pairs a box
// the way a phone pairs: run the line on it, then confirm with Touch ID here when the codes match.
import type { DeviceKind, DeviceView } from "@/lib/device-registry";
import { timeAgo } from "@/lib/format";
import { useDevices } from "@/lib/use-devices";
import { useNow } from "@/lib/use-now";
import { Spinner } from "./Icon";
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

function seenLine(d: DeviceView, now: number): string {
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
      <p className="text-[13px] text-ink">Run this on the box. When it prints a code, Touch ID here will name the same one.</p>
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
  const list = devices.view?.devices ?? [];
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
            <li key={d.id} className={`flex items-center justify-between gap-3 ${d.revokedAt ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink">{d.name}</div>
                <div className={SUBTLE}>
                  {holdsLine(d)} · {seenLine(d, now)}
                </div>
              </div>
              {!d.revokedAt && (
                <div className="flex shrink-0 gap-2">
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
                  <button type="button" className={BUTTON} onClick={() => void devices.revoke(d)} aria-label={`Revoke ${d.name}`}>
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

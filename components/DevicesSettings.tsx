"use client";

// Settings → Devices (docs/architecture/device-registry.md): every Mac, worker, phone and browser of yours in one list,
// from the one registry, each with the keys it holds and a Revoke that works whatever its kind. Add a worker pairs a box
// the way a phone pairs: run the line on it, then confirm with Touch ID here when the codes match.
import type { DeviceKind, DeviceView } from "@/lib/device-registry";
import { newestVersion, versionText } from "@/lib/device-version";
import { timeAgo } from "@/lib/format";
import { sealLine, useDevices } from "@/lib/use-devices";
import { useNow } from "@/lib/use-now";
import { useState } from "react";
import { ForgetButton, ForgetConfirm, forgetLine } from "./WorkerActions";
import { Spinner } from "./Icon";
import { ThisMacStanding } from "./DeviceStanding";
import { MoveThreads, RevokeConfirm } from "./WorkerMoveThreads";
import { offersMove, threadsText } from "@/lib/device-move";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";

const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
// The one row with a panel open under it, and which.
type Open = { id: string; what: "move" | "revoke" | "forget" };
const KIND: Record<DeviceKind, string> = { mac: "Mac", worker: "Worker", phone: "Phone", browser: "Browser" };

// What it can do, from the keys it holds: the one line under its name.
function holdsLine(d: DeviceView): string {
  const parts = [KIND[d.kind]];
  if (d.approves) parts.push(d.kind === "browser" ? "approves with a passkey" : "approves with Face ID");
  else if (d.hasBoxKey && d.kind !== "worker") parts.push("reads sealed threads");
  if (d.kind === "worker") parts.push(d.hasSignKey ? "paired" : "enrolled by token");
  if (d.here) parts.push("this Mac");
  if (d.threads) parts.push(threadsText(d.threads));
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

// Whether a worker's threads go up sealed (docs/architecture/mobile-security.md#sealing-on-a-weft-worker): "Threads sealed
// (key v3)", or "Threads in the clear · Seal…" for a paired one, folded into the line under its name.
function WorkerSeal({ d, devices }: { d: DeviceView; devices: ReturnType<typeof useDevices> }) {
  const line = sealLine(devices.keys, d.id);
  return (
    <>
      {" · "}
      {line.text}
      {!line.sealed && d.hasSignKey && devices.canSeal && (
        <>
          {" · "}
          <button type="button" className="text-ink underline-offset-2 hover:underline" onClick={() => void devices.seal(d)} aria-label={`Seal ${d.name}'s threads`} title="Give this worker the key to your sealed threads, after Touch ID, so weft.zip only ever holds its threads, pages and files as ciphertext">
            Seal…
          </button>
        </>
      )}
    </>
  );
}

// A live device's button: a worker's Forget (components/WorkerActions.tsx), Revoke for every other kind. A token-enrolled
// worker that owns threads can't bring them back on a new pairing, so its Forget offers the move first.
function DeviceActions({ d, devices, onOpen }: { d: DeviceView; devices: ReturnType<typeof useDevices>; onOpen: (what: Open["what"]) => void }) {
  if (d.kind === "worker") return <ForgetButton d={d} onForget={() => onOpen(d.threads && !d.hasSignKey ? "revoke" : "forget")} />;
  return (
    <button type="button" className={BUTTON} onClick={() => void devices.revoke(d)} aria-label={`Revoke ${d.name}`}>
      Revoke
    </button>
  );
}

// A row's left side: its name, what it holds and when it was seen, and any warning.
function DeviceSummary({ d, devices, line, now, newest }: { d: DeviceView; devices: ReturnType<typeof useDevices>; line: string | null; now: number; newest: string | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13px] text-ink">{d.name}</div>
      <div className={SUBTLE}>
        {holdsLine(d)} · {seenLine(d, now, newest)}
        {d.kind === "worker" && !d.revokedAt && <WorkerSeal d={d} devices={devices} />}
        {devices.untaken.includes(d.id) && <span className="text-warn" title="This Mac changed which passkeys this worker trusts, and the worker hasn't confirmed it yet: until it does, a passkey you revoked may still approve there. Weft keeps sending it."> · passkeys not updated yet</span>}
      </div>
      {d.note && !d.revokedAt && <div className="text-[12.5px] text-warn">{d.note}</div>}
      {line && <div className={SUBTLE}>{line}</div>}
    </div>
  );
}

// One device: its summary and button, and under it whichever panel is open (a confirm or a move).
function DeviceRow({ d, list, devices, now, newest, open, setOpen }: { d: DeviceView; list: DeviceView[]; devices: ReturnType<typeof useDevices>; now: number; newest: string | null; open: Open | null; setOpen: (o: Open | null) => void }) {
  const line = d.kind === "worker" && !d.revokedAt ? forgetLine(d.name) : null;
  const what = open?.id === d.id ? open.what : null;
  const close = () => setOpen(null);
  return (
    <li className={`flex flex-wrap items-center justify-between gap-x-3 ${d.revokedAt ? "opacity-60" : ""}`}>
      <DeviceSummary d={d} devices={devices} line={line} now={now} newest={newest} />
      <div className="flex shrink-0 items-center gap-2">
        {offersMove(d, list) && (
          <button type="button" className={BUTTON} onClick={() => setOpen({ id: d.id, what: "move" })} aria-label={`Move ${d.name}'s threads`} title="Move the threads this worker owns to another worker of yours, so that box runs and publishes them">
            Move threads to…
          </button>
        )}
        {!d.revokedAt && <DeviceActions d={d} devices={devices} onOpen={(w) => setOpen({ id: d.id, what: w })} />}
      </div>
      {what === "forget" && <ForgetConfirm d={d} onForget={() => void devices.forget(d)} onClose={close} />}
      {what === "move" && <MoveThreads device={d} devices={list} onMove={(to) => void devices.moveThreads(d, to)} onClose={close} />}
      {what === "revoke" && <RevokeConfirm device={d} devices={list} onRevoke={(to) => void devices.revoke(d, to)} onClose={close} />}
    </li>
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
  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SettingsSectionHeader title="Your devices" hint="Every Mac, worker, phone and browser that holds a key of yours. Revoke or Forget one and its keys stop working." />
        <AddWorker devices={devices} />
      </div>
      {devices.view && !devices.view.signedIn && <p className={`mt-3 ${SUBTLE}`}>Sign in to Weft to see your devices.</p>}
      {devices.note && <p className="mt-3 text-[12.5px] text-ink">{devices.note}</p>}
      {devices.error && <p className="mt-3 text-[12.5px] text-danger">{devices.error}</p>}
      <div className="mt-3 empty:hidden">
        <ThisMacStanding onDone={() => setFixError(null)} notify={(err) => setFixError(err instanceof Error ? err.message : String(err))} />
      </div>
      {fixError && <p className="mt-2 text-[12.5px] text-danger">{fixError}</p>}
      {list.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {list.map((d) => (
            <DeviceRow key={d.id} d={d} list={list} devices={devices} now={now} newest={newest} open={open} setOpen={setOpen} />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

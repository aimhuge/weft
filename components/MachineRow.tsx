"use client";

// One physical machine in Settings → Devices (lib/machines.ts folds the registry's rows into it): its name, one status
// line, what it holds in plain words, and the actions of each underlying row, labelled so it's clear which row they hit.
import type { DeviceKind, DeviceView } from "@/lib/device-registry";
import { versionText } from "@/lib/device-version";
import { offersMove, threadsText } from "@/lib/device-move";
import { timeAgo } from "@/lib/format";
import type { Machine } from "@/lib/machines";
import { sealLine, type useDevices } from "@/lib/use-devices";
import { ForgetConfirm, forgetLine } from "./WorkerActions";
import { ShareWork } from "./MacPairing";
import { MoveThreads, RevokeConfirm } from "./WorkerMoveThreads";

export const SUBTLE = "text-[12.5px] text-muted";
export const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50";
// The one row with a panel open under it, and which.
export type Open = { id: string; what: "move" | "revoke" | "forget" };
type Devices = ReturnType<typeof useDevices>;
const KIND: Record<DeviceKind, string> = { mac: "Mac", worker: "Worker", phone: "Phone", browser: "Browser" };

const liveRows = (m: Machine): DeviceView[] => [m.mac, m.worker, ...m.others].filter((d): d is DeviceView => Boolean(d));

// "Mac and worker", "Phone": which kinds of row make up the machine.
function kindsLine(m: Machine): string {
  const kinds: DeviceKind[] = liveRows(m).map((d) => d.kind).filter((k, i, all) => all.indexOf(k) === i);
  return kinds.map((k, i) => (i ? KIND[k].toLowerCase() : KIND[k])).join(" and ");
}

function statusLine(m: Machine, now: number): string {
  const rows = liveRows(m);
  if (rows.some((d) => d.status === "online")) return "Online";
  if (rows.some((d) => d.status === "busy")) return "Busy";
  const seen = rows.map((d) => (d.lastSeenAt ? Date.parse(d.lastSeenAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
  return seen ? `Seen ${timeAgo(seen, now)}` : "Never seen";
}

export function subtitle(m: Machine, now: number, newest: string | null): string {
  const build = liveRows(m).find((d) => d.build)?.build ?? null;
  const v = versionText(build, newest);
  return [kindsLine(m), m.here && "this Mac", statusLine(m, now), v].filter(Boolean).join(" · ");
}

// What each row holds, in plain words (the second, muted line).
export function holdsLine(d: DeviceView): string[] {
  const parts: string[] = [];
  if (d.approves) parts.push(d.kind === "browser" ? "approves with a passkey" : "approves with Face ID");
  else if (d.hasBoxKey && d.kind !== "worker") parts.push("can open your encrypted threads");
  if (d.kind === "worker") parts.push(d.hasSignKey ? "paired" : "added with a setup token (older)");
  if (d.threads) parts.push(threadsText(d.threads));
  return parts;
}

// A worker's encryption: "Threads encrypted (key v3)", or "Threads not encrypted · Encrypt…" for a paired one.
function WorkerSeal({ d, devices }: { d: DeviceView; devices: Devices }) {
  const line = sealLine(devices.keys, d.id);
  return (
    <>
      {" · "}
      {line.text}
      {!line.sealed && d.hasSignKey && devices.canSeal && (
        <>
          {" · "}
          <button type="button" className="text-ink underline-offset-2 hover:underline" onClick={() => void devices.seal(d)} aria-label={`Seal ${d.name}'s threads`} title="Give this worker the key to your encrypted threads, after Touch ID, so weft.zip only ever holds its threads, pages and files as ciphertext">
            Encrypt…
          </button>
        </>
      )}
    </>
  );
}

interface Props {
  m: Machine;
  list: DeviceView[];
  devices: Devices;
  now: number;
  newest: string | null;
  open: Open | null;
  setOpen: (o: Open | null) => void;
}

// The buttons of one underlying row. `both` is a Mac and a worker on one machine: then the labels say which.
function RowActions({ d, both, devices, list, setOpen }: { d: DeviceView; both: boolean; devices: Devices; list: DeviceView[]; setOpen: Props["setOpen"] }) {
  if (d.kind === "worker")
    return (
      <>
        {offersMove(d, list) && (
          <button type="button" className={BUTTON} onClick={() => setOpen({ id: d.id, what: "move" })} aria-label={`Move ${d.name}'s threads`} title="Move the threads this worker owns to another worker of yours, so that box runs and publishes them">
            Move threads to…
          </button>
        )}
        {/* A token-added worker that owns threads can't bring them back on a new pairing, so its Forget offers the move first. */}
        <button type="button" className={BUTTON} onClick={() => setOpen({ id: d.id, what: d.threads && !d.hasSignKey ? "revoke" : "forget" })} aria-label={`Forget ${d.name}`}>
          {both ? "Forget worker" : "Forget"}
        </button>
      </>
    );
  return (
    <button type="button" className={BUTTON} onClick={() => void devices.revoke(d)} aria-label={`Revoke ${d.name}`}>
      {both ? "Revoke app key" : "Revoke"}
    </button>
  );
}

export function MachineRow({ m, list, devices, now, newest, open, setOpen }: Props) {
  const rows = liveRows(m);
  const both = Boolean(m.mac && m.worker);
  const holds = rows.flatMap(holdsLine);
  const open1 = rows.find((d) => open?.id === d.id);
  const what = open1 && open ? open.what : null;
  const close = () => setOpen(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3">
      <div className="min-w-0">
        <div className="truncate text-[13px] text-ink">{m.name}</div>
        <div className={SUBTLE}>{subtitle(m, now, newest)}</div>
        <div className={SUBTLE}>
          {holds.join(" · ")}
          {m.worker && <WorkerSeal d={m.worker} devices={devices} />}
          {rows.some((d) => devices.untaken.includes(d.id)) && <span className="text-warn" title="This Mac changed which passkeys this worker trusts, and the worker hasn't confirmed it yet: until it does, a passkey you revoked may still approve there. Weft keeps sending it."> · passkeys not updated yet</span>}
        </div>
        {rows.map((d) => d.note && <div key={d.id} className="text-[12.5px] text-warn">{d.note}</div>)}
        {m.worker && <div className={SUBTLE}>{forgetLine(m.worker.name)}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {rows.map((d) => (
          <RowActions key={d.id} d={d} both={both} devices={devices} list={list} setOpen={setOpen} />
        ))}
      </div>
      {!m.here && m.mac && <ShareWork id={m.mac.host} name={m.name} />}
      {open1 && what === "forget" && <ForgetConfirm d={open1} onForget={() => void devices.forget(open1)} onClose={close} />}
      {open1 && what === "move" && <MoveThreads device={open1} devices={list} onMove={(to) => void devices.moveThreads(open1, to)} onClose={close} />}
      {open1 && what === "revoke" && <RevokeConfirm device={open1} devices={list} onRevoke={(to) => void devices.revoke(open1, to)} onClose={close} />}
    </li>
  );
}

// A revoked row, under the closed "Revoked (n)" list.
export function RevokedRow({ d, list, devices, now, setOpen, open }: { d: DeviceView; list: DeviceView[]; devices: Devices; now: number; setOpen: Props["setOpen"]; open: Open | null }) {
  const holds = holdsLine(d);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 opacity-60">
      <div className="min-w-0">
        <div className="truncate text-[13px] text-ink">{d.name}</div>
        <div className={SUBTLE}>
          {[KIND[d.kind], `Revoked ${d.revokedAt ? timeAgo(Date.parse(d.revokedAt), now) : ""}`.trim(), ...holds].join(" · ")}
        </div>
      </div>
      {offersMove(d, list) && (
        <button type="button" className={BUTTON} onClick={() => setOpen({ id: d.id, what: "move" })} aria-label={`Move ${d.name}'s threads`}>
          Move threads to…
        </button>
      )}
      {open?.id === d.id && open.what === "move" && <MoveThreads device={d} devices={list} onMove={(to) => void devices.moveThreads(d, to)} onClose={() => setOpen(null)} />}
    </li>
  );
}

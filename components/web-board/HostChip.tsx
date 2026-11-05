"use client";

// The host chip in a worker card's pane header, beside Share (lib/host-chip.ts says what it reads): the machine the
// card runs on ("m1mini"), "+ simulator" while one runs for it, and a menu of where that simulator runs. It replaced
// the Local Simulator toggle and the toolbar's Start simulator, so it takes no more room than they did.
//
// On <worker>: start its simulator, or switch the device it streams. On this Mac (the desktop board only, `local`):
// Local Simulator mode, where picking a device asks for Touch ID (components/use-local-simulator.ts). Run this card on
// this Mac is shown but off: moving a running card between machines has no verb yet.
import { useRef, useState, type ReactNode } from "react";
import { hostChipLabel, hostChipShown, hostName } from "@/lib/host-chip";
import { useLocalMenu, useMenuCoverPublisher } from "@/lib/overlay";
import { stableId } from "@/lib/qa-id";
import type { ScreenDevice } from "@/lib/share-types";
import type { Device } from "@/lib/simulator-devices";
import { useEscape } from "@/lib/use-escape";
import { useMenuOpen } from "@/lib/use-menu-open";
import type { BoardInput } from "@/lib/worker-commands";
import Icon from "../Icon";

// Local Simulator mode on this card, as the desktop board reads it.
export interface LocalSimulator {
  on: boolean;
  // This Mac's devices were read; until then there's nothing to pick.
  ready: boolean;
  // The device this Mac approved, while on.
  approved: string | null;
  devices: Device[];
  // Waiting for Touch ID, or for the worker to hear.
  busy: boolean;
  problem: string;
  send: (device: string | null) => void;
}

export interface HostChipProps {
  worker?: string;
  // The worker's live screen, while the pane shows it.
  screen?: { device: string; devices: ScreenDevice[]; label: string };
  // Present where this board can drive the worker.
  onScreenInput?: (input: BoardInput) => Promise<void>;
  mobileApp?: boolean;
  local?: LocalSimulator;
}

export const NOT_YET = "Not yet: moving a card between machines";
const ITEM = "block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken";
const NOTE = "px-2 py-1 text-[11.5px] text-faint";
const HEAD = "px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted";

function Head({ children }: { children: ReactNode }) {
  return <p className={HEAD}>{children}</p>;
}

function WorkerSection({ host, screen, onScreenInput, canStart, start, close }: Pick<HostChipProps, "screen" | "onScreenInput"> & { host: string; canStart: boolean; start: () => void; close: () => void }) {
  const watch = (device: string) => {
    close();
    onScreenInput?.({ kind: "watch", device }).catch(() => {});
  };
  let body: ReactNode = <p className={NOTE}>No simulator running.</p>;
  if (screen && onScreenInput) {
    const choices = screen.devices.some((d) => d.id === screen.device) ? screen.devices : [{ id: screen.device, name: screen.label }, ...screen.devices];
    body = choices.map((d) => (
      <button key={d.id} type="button" role="menuitemradio" aria-checked={d.id === screen.device} className={ITEM} onClick={() => watch(d.id)}>
        {d.id === screen.device ? "✓ " : ""}
        {d.name}
      </button>
    ));
  } else if (screen) body = <p className={NOTE}>Streaming {screen.label}.</p>;
  else if (canStart)
    body = (
      <button type="button" role="menuitem" className={ITEM} onClick={start}>
        📱 Start simulator
      </button>
    );
  return (
    <>
      <Head>Simulator on {host}</Head>
      {body}
    </>
  );
}

function LocalSection({ local, host, close }: { local: LocalSimulator; host: string; close: () => void }) {
  const send = (device: string | null) => {
    close();
    local.send(device);
  };
  let body: ReactNode;
  if (local.on)
    body = (
      <button type="button" role="menuitem" className={ITEM} title={`Back to ${host}'s device`} onClick={() => send(null)}>
        ■ Stop simulator <span className="text-faint">· {local.approved}</span>
      </button>
    );
  else if (!local.ready) body = <p className={NOTE}>Can&apos;t read this Mac&apos;s devices right now.</p>;
  else if (!local.devices.length) body = <p className={NOTE}>No simulators here. Settings → Connectors → Simulators.</p>;
  else
    body = (
      <>
        <p className={NOTE}>Builds from {host} run on your Mac as you, for 8 hours.</p>
        {local.devices.map((d) => (
          <button key={d.id} type="button" role="menuitem" className={ITEM} onClick={() => send(stableId(d))}>
            {d.state === "booted" ? "● " : ""}
            {d.name}
            <span className="text-faint"> · {d.runtime ?? d.platform}</span>
          </button>
        ))}
      </>
    );
  return (
    <>
      <Head>Simulator on this Mac</Head>
      {body}
    </>
  );
}

function RunSection({ host }: { host: string }) {
  return (
    <>
      <Head>Run this card</Head>
      <p className={NOTE}>✓ On {host}</p>
      <button type="button" role="menuitem" aria-disabled="true" title={NOT_YET} className={`${ITEM} cursor-default opacity-50 hover:bg-transparent`}>
        Run this card on this Mac <span className="text-faint">· not yet</span>
      </button>
    </>
  );
}

function chipText(label: string, starting: boolean, local: LocalSimulator | undefined, failed: string) {
  if (local?.busy) return "Waiting for Touch ID…";
  if (starting) return "Starting simulator…";
  return failed || local?.problem ? `${label} ⚠` : label;
}

export function HostChip({ worker, screen, onScreenInput, mobileApp, local }: HostChipProps) {
  const [open, setOpen] = useState(false);
  const [startedOn, setStartedOn] = useState(false);
  const [failed, setFailed] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuOpen({ open, setOpen, menuRef: root });
  useEscape(open, () => setOpen(false));
  useLocalMenu(open);
  useMenuCoverPublisher(menu, open);
  const canStart = Boolean(mobileApp && onScreenInput);
  if (!hostChipShown({ local: Boolean(local), streaming: Boolean(screen), canStart })) return null;

  const host = hostName(worker);
  const localOn = Boolean(local?.on);
  const label = hostChipLabel({ worker, streaming: Boolean(screen), localOn });
  const close = () => setOpen(false);
  // The live screen replaces the pane once the worker streams, so "starting" only ends early on a failure.
  const start = () => {
    close();
    setStartedOn(true);
    setFailed("");
    onScreenInput?.({ kind: "watch" }).catch((err: unknown) => {
      setStartedOn(false);
      setFailed((err as Error).message);
    });
  };
  const text = chipText(label, startedOn && !screen, local, failed);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={local?.busy}
        title={failed || local?.problem || "Where this card runs, and its simulator"}
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[14rem] items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] hover:bg-sunken hover:text-ink disabled:opacity-50 ${screen || localOn ? "text-ink" : "text-muted"}`}
      >
        <span className="truncate">{text}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Where this card runs" className="absolute right-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg">
          {!localOn && <WorkerSection host={host} screen={screen} onScreenInput={onScreenInput} canStart={canStart} start={start} close={close} />}
          {local && <LocalSection local={local} host={host} close={close} />}
          {local && <RunSection host={host} />}
        </div>
      )}
    </div>
  );
}

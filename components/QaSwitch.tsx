"use client";

// The Local Simulator switch in a worker card's pane toolbar (docs/architecture/manual-qa.md). Off: a menu of this Mac's devices,
// and picking one asks for Touch ID. On: names the device and switches off. It takes no row: the pane's toolbar has room.
// Only the desktop draws it, because the yes has to be given on the Mac the build will run on.
import { useCallback, useEffect, useState } from "react";
import { stableId } from "@/lib/qa-id";
import type { Card } from "@/lib/types";
import { readQa, sendWorkerAction, type QaState } from "@/lib/worker-transport";

export interface UseQa {
  state: QaState | null;
  on: boolean;
  refresh: () => void;
}

export function useQa(card: Pick<Card, "id" | "qaDevice">): UseQa {
  const [state, setState] = useState<QaState | null>(null);
  const refresh = useCallback(() => {
    readQa(card.id).then(setState, () => setState(null));
  }, [card.id]);
  useEffect(refresh, [refresh]);
  // Approved here, and the worker has heard: a lapsed approval reads as off, so a click asks again.
  return { state, on: Boolean(state?.approved && card.qaDevice === state.mac), refresh };
}

const BUTTON = "whitespace-nowrap rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-50";

export function QaSwitch({ card, qa }: { card: Pick<Card, "id" | "qaDevice">; qa: UseQa }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (device: string | null) => {
    setOpen(false);
    setBusy(true);
    setProblem("");
    sendWorkerAction({ action: "qa", cardId: card.id, device })
      .catch((err: unknown) => setProblem((err as Error).message))
      .finally(() => {
        setBusy(false);
        qa.refresh();
      });
  };

  if (qa.on) {
    return (
      <button type="button" className={BUTTON} disabled={busy} title="Runs on this Mac. Click to go back to the worker's device." onClick={() => send(null)}>
        Local: {qa.state?.approved} ✕
      </button>
    );
  }
  return (
    <div className="relative">
      <button type="button" className={BUTTON} disabled={busy || !qa.state} title={problem || "Run this thread's app on a simulator on this Mac"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {busy ? "Waiting for Touch ID…" : problem ? "Local Simulator ⚠" : "Local Simulator"}
      </button>
      {open && (
        <div role="menu" aria-label="Devices on this Mac" className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg">
          <p className="px-2 py-1 text-[11.5px] text-faint">Builds from this worker run on your Mac as you, for 8 hours.</p>
          {qa.state?.devices.map((d) => (
            <button key={d.id} type="button" role="menuitem" className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken" onClick={() => send(stableId(d))}>
              {d.state === "booted" ? "● " : ""}
              {d.name}
              <span className="text-faint"> · {d.runtime ?? d.platform}</span>
            </button>
          ))}
          {!qa.state?.devices.length && <p className="px-2 py-1.5 text-[12.5px] text-muted">No simulators here. Settings → Connectors → Simulators.</p>}
        </div>
      )}
    </div>
  );
}

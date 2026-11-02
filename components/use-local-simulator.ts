"use client";

// Local Simulator mode's state on a worker card (docs/architecture/manual-qa.md), for the host chip in its pane header
// (components/web-board/HostChip.tsx). Off: the chip's menu lists this Mac's devices, and picking one asks for Touch ID.
// On: the menu stops it, back to the worker's device. Only the desktop has it, because the yes has to be given on the
// Mac the build will run on.
import { useCallback, useEffect, useState } from "react";
import type { Card } from "@/lib/types";
import { readQa, sendWorkerAction, type QaState } from "@/lib/worker-transport";
import type { LocalSimulator } from "./web-board/HostChip";

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

// The switch itself: a device's stable id to switch on (Touch ID first, in Electron main), null to switch off.
export function useLocalSimulator(card: Pick<Card, "id" | "qaDevice">): LocalSimulator {
  const qa = useQa(card);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const send = (device: string | null) => {
    setBusy(true);
    setProblem("");
    sendWorkerAction({ action: "qa", cardId: card.id, device })
      .catch((err: unknown) => setProblem((err as Error).message))
      .finally(() => {
        setBusy(false);
        qa.refresh();
      });
  };
  return { on: qa.on, ready: Boolean(qa.state), approved: qa.state?.approved ?? null, devices: qa.state?.devices ?? [], busy, problem, send };
}

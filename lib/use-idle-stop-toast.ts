"use client";

import { useEffect, useRef } from "react";
import { formatMem } from "./services-view";
import type { ServiceEntry } from "./types";
import type { ToastAction } from "./use-toast";

// An idle dev server Weft didn't start gets a toast before Weft stops it (lib/dev-idle-loop.ts, 90 s of grace): its
// Undo keeps it. Once per server; the row's Keep stays there through the grace too.

export function stopToast(s: ServiceEntry): string {
  const where = s.cwd ? ` in ${s.cwd.split("/").pop()}` : "";
  const mem = s.footprintKb ?? s.memKb;
  return `Stopping idle ${s.label}${where}${mem ? ` (${formatMem(mem)})` : ""}: no visitors for 30 minutes.`;
}

// The next service with a stop announced that hasn't had its toast, marked told (one toast at a time; the next poll
// brings the next one).
export function nextStop(services: readonly ServiceEntry[], told: Set<string>): ServiceEntry | undefined {
  const next = services.find((s) => s.stopAt && !told.has(s.id));
  if (next) told.add(next.id);
  return next;
}

export function useIdleStopToast(services: readonly ServiceEntry[], toast: ((text: string, action?: ToastAction) => void) | undefined, keep: (id: string) => Promise<void>) {
  const told = useRef(new Set<string>());
  useEffect(() => {
    if (!toast) return;
    const next = nextStop(services, told.current);
    if (next) toast(stopToast(next), { label: "Undo", run: () => void keep(next.id) });
  }, [services, toast, keep]);
}

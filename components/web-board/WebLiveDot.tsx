"use client";

// The dot at the right end of the weft.zip header: whether the Realtime channel is up. The desktop board is
// local, so it has no such dot — the header's `live` slot is where this one goes (components/BoardHeader.tsx).
import type { LiveStatus } from "./useWebBoard";

export function WebLiveDot({ status }: { status: LiveStatus }) {
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline";
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
      <span aria-hidden="true" className={`size-2 rounded-full ${status === "live" ? "bg-ok" : "bg-faint"}`} />
      {label}
    </span>
  );
}

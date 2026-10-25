"use client";

import { railTitle } from "@/lib/vault-view";

// 🔐 under the library's icons: its count is names still missing a value, its dot a .env.local to import.
export default function VaultButton({ open, badge, onClick }: { open: boolean; badge: { missing: number; nudge: boolean; vercel?: string }; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={railTitle(badge)}
      aria-pressed={open}
      className={`relative grid size-7 place-items-center rounded-md text-[14px] ${open ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
    >
      <span aria-hidden>🔐</span>
      <span className="sr-only">Secrets</span>
      {badge.missing > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-warn px-1 text-center text-[9px] font-semibold leading-[14px] text-on-accent">{badge.missing}</span>
      ) : (
        (badge.nudge || Boolean(badge.vercel)) && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-panel" aria-label={badge.nudge ? "Values to import" : "Out of step with Vercel"} />
      )}
    </button>
  );
}

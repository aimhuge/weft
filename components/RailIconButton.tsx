"use client";

import { useUiText } from "@/lib/ui-language";

// A plain icon under the left rail's divider that opens its drawer: 🪝 webhooks, ▲ Vercel, Supabase's bolt, Cloudflare's cloud, BlastCP's rocket, GitHub's mark, 🖥 dev servers. 🔐 has its own,
// with badges (components/LibraryRail.tsx). count draws a bubble when above zero: bad (red, something broken or unapplied), warn (something to do) or ok (something running).
export default function RailIconButton({ icon, label, open, title, count = 0, tone = "warn", onClick }: { icon: React.ReactNode; label: string; open: boolean; title: string; count?: number; tone?: "warn" | "ok" | "bad"; onClick: () => void }) {
  const t = useUiText();
  return (
    <button
      onClick={onClick}
      title={t(title)}
      aria-pressed={open}
      className={`relative grid size-7 place-items-center rounded-md text-[13px] ${open ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="sr-only">{t(label)}</span>
      {count > 0 && <span className={`absolute -right-1 -top-1 min-w-[14px] rounded-full ${tone === "ok" ? "bg-ok" : tone === "bad" ? "bg-danger" : "bg-warn"} px-1 text-center text-[9px] font-semibold leading-[14px] text-on-accent`}>{count}</span>}
    </button>
  );
}

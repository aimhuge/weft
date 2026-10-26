"use client";

import { useEffect, useRef, useState } from "react";
import { skillsOnCount } from "@/lib/skill-set-view";
import { useEscape } from "@/lib/use-escape";
import { useSkillSet } from "@/lib/use-skill-set";
import type { Card } from "@/lib/types";
import SkillSetList from "./SkillSetList";

const logError = (err: unknown) => console.error(err);

// ✦ in a card's header: the skills this thread gets, and a menu to change them for this card alone
// (lib/skill-sets.ts). The CLI reads them as it starts, so a change applies from the next message.
export default function SkillsChip({ card, notify = logError }: { card: Card; notify?: (err: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { view, toggle, reload } = useSkillSet({ card: card.id }, true, notify);
  const changed = (card.skillsOn?.length ?? 0) + (card.skillsOff?.length ?? 0);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={changed ? `Skills: ${changed} changed for this card` : "Skills this thread gets"}
        className={`whitespace-nowrap rounded px-1 hover:bg-sunken ${changed ? "text-accent" : "text-muted"}`}
      >
        ✦{view ? ` ${skillsOnCount(view.rows)}` : ""}
      </button>
      {open && (
        <div role="dialog" aria-label="Skills for this card" className="absolute left-0 top-full z-30 mt-1 flex max-h-[420px] w-[300px] flex-col rounded-lg border border-line-strong bg-panel shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]">
          <p className="border-b border-line px-3 py-2 text-[11.5px] text-muted">
            For this card only. Applies from your next message; the project’s default is in ✦ on the rail.
          </p>
          <SkillSetList view={view} forCard onToggle={toggle} cwd={card.cwd} onInstalled={reload} />
        </div>
      )}
    </div>
  );
}

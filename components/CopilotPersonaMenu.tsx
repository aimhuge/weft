"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { PERSONA_ORDER, PERSONAS, personaOf, type CopilotPersona } from "@/lib/copilot-personas";
import { useEscape } from "@/lib/use-escape";
import { Avatar } from "./CopilotHider";
import Icon from "./Icon";

// The copilot's name in the lane header, which opens the persona picker. Picking another starts a new chat,
// since the copilot's CLI reads its persona only when it starts (lib/copilot.ts setCopilotPersona). The menu hangs
// from the header (its nearest positioned box), as wide as the peek's 236px lane allows.
export default function CopilotPersonaMenu(props: {
  persona: string | undefined;
  busy: boolean;
  onPick: (persona: CopilotPersona) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = personaOf(props.persona);
  // Whether the copilot checks in on its own (lib/copilot-initiative.ts); read each time the menu opens.
  const [checkIns, setCheckIns] = useState<boolean | null>(null);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    api.copilotCheckIns().then((r) => setCheckIns(r.on), () => setCheckIns(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  return (
    <div ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={props.busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose your copilot"
        className="-ml-1 flex items-center gap-0.5 rounded px-1 text-[13px] font-semibold text-ink hover:bg-black/30 disabled:opacity-60"
      >
        {current.name}
        <Icon name="chevronDown" size={12} className="text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute inset-x-2 top-full z-30 max-w-[300px] rounded-lg border border-line-strong bg-panel p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
        >
          {PERSONA_ORDER.map((id) => {
            const p = PERSONAS[id];
            const on = id === current.id;
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setOpen(false);
                  if (!on) props.onPick(id);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-sunken ${on ? "bg-sunken" : ""}`}
              >
                <Avatar size={28} picture={p.picture} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[12.5px] font-semibold text-ink">{p.name}</span>
                  <span className="block text-[11.5px] text-muted">{p.tagline}</span>
                </span>
                {on && <Icon name="check" size={13} className="text-accent" />}
              </button>
            );
          })}
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-faint">Switching starts a new chat.</p>
          {checkIns !== null && (
            <button
              role="menuitemcheckbox"
              aria-checked={checkIns}
              onClick={() => {
                const on = !checkIns;
                setCheckIns(on);
                api.setCopilotCheckIns(on).catch(() => setCheckIns(!on));
              }}
              className="mt-1 flex w-full items-start gap-2 rounded-md border-t border-line px-2 py-1.5 text-left hover:bg-sunken"
            >
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[12.5px] font-semibold text-ink">Checks in on its own</span>
                <span className="block text-[11.5px] text-muted">A morning idea, and a refactor after work lands. At most 3 a day.</span>
              </span>
              <Icon name={checkIns ? "check" : "x"} size={13} className={checkIns ? "text-accent" : "text-faint"} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

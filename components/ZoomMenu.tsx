"use client";

import { useEffect, useRef, useState } from "react";
import { keyCaps } from "@/lib/hotkeys";
import { useLocalMenu, useMenuCoverPublisher } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";
import Icon, { type IconName } from "./Icon";

type ZoomAction = "in" | "out" | "reset" | number;

const STEPS: { action: ZoomAction; label: string; icon: IconName; keys: string }[] = [
  { action: "in", label: "Zoom in", icon: "zoom-in", keys: "mod++" },
  { action: "out", label: "Zoom out", icon: "zoom-out", keys: "mod+-" },
  { action: "reset", label: "Actual size", icon: "search", keys: "mod+0" },
];
const PRESETS = [50, 75, 100, 125, 150, 200];

// The browser pane's zoom: a % button whose menu reads like the command palette (icon, label, key caps).
// The page is a native view drawn above the board, so the menu can't sit on top of it: the pane keeps
// the page visible and steps it aside around the menu's rectangle (lib/overlay.ts).
export default function ZoomMenu({ zoom, disabled }: { zoom: number; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLocalMenu(open);
  // The menu measures itself and publishes the rectangle it covers, so the pane's page steps aside
  // around it instead of vanishing under it.
  useMenuCoverPublisher(menu, open);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  function pick(action: ZoomAction) {
    window.weft?.browser.zoom(action);
    setOpen(false);
  }

  const row = "flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div ref={root} className="relative">
      <button
        className={`rounded-md px-1.5 py-1 font-mono text-[11px] tabular-nums hover:bg-sunken disabled:opacity-30 ${
          zoom === 100 ? "text-muted hover:text-ink" : "text-accent"
        }`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-label="Page zoom"
        aria-expanded={open}
      >
        {zoom}%
      </button>
      {open && (
        <div
          ref={menu}
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-line bg-panel p-1 shadow-lg"
        >
          {STEPS.map((step) => (
            <button key={step.label} className={row} disabled={step.action === "reset" && zoom === 100} onClick={() => pick(step.action)}>
              <Icon name={step.icon} size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{step.label}</span>
              <span className="flex shrink-0 items-center gap-0.5">
                {keyCaps(step.keys).map((cap, i) => (
                  <kbd
                    key={i}
                    className="min-w-[20px] rounded border border-line-strong bg-canvas px-1 py-px text-center font-mono text-[11px] text-muted"
                  >
                    {cap}
                  </kbd>
                ))}
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          {PRESETS.map((z) => (
            <button key={z} className={row} onClick={() => pick(z)}>
              <span className="flex w-[14px] shrink-0 justify-center text-accent">{z === zoom && <Icon name="check" size={13} />}</span>
              <span className="flex-1 font-mono text-[12.5px] tabular-nums text-ink">{z}%</span>
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-faint">⌘+scroll zooms, pinch magnifies.</p>
        </div>
      )}
    </div>
  );
}

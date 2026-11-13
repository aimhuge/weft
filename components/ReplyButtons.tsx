"use client";

import { useEffect, useRef, useState } from "react";
import type { ReplyAction, ReplyModeView, ReplyTone } from "@/lib/reply-mode";
import { FIXED_SHORTCUTS } from "@/lib/shortcut-catalog";
import { useEscape } from "@/lib/use-escape";
import Icon, { Spinner } from "./Icon";
import KeyCaps from "./KeyCaps";
import Tip from "./Tip";

// The key that stops a running turn from the reply box, as the shortcuts sheet lists it.
const STOP_KEY = FIXED_SHORTCUTS.find((s) => s.id === "reply-stop")?.keys[0] ?? "ctrl+c";

const TONE: Record<ReplyTone, string> = {
  accent: "bg-accent text-on-accent",
  neutral: "border border-line-strong bg-sunken text-ink",
  shell: "bg-ok-soft text-ok ring-1 ring-inset ring-ok",
  warn: "bg-warn-soft text-warn ring-1 ring-inset ring-warn",
};

// The reply box's buttons (lib/reply-mode.ts decides what they say): Stop in its own slot while a turn runs, so
// nothing else moves when one starts, then one primary that names what Enter does, with a ▾ for the rest (Send
// now, Send later…, Continue here, Send here instead of a new card). Every press goes back through onAction.
export default function ReplyButtons({
  view,
  live,
  sending,
  onAction,
  onStop,
}: {
  view: ReplyModeView;
  live: boolean;
  sending: boolean;
  onAction: (action: ReplyAction) => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tone = TONE[view.tone];

  useEscape(open, (e) => {
    e.stopPropagation();
    setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={root} className="relative ml-auto flex shrink-0 items-center gap-1 pl-1">
      {live && (
        <Tip text={<span className="flex items-center gap-1.5">Stop this turn <KeyCaps spec={STOP_KEY} small /></span>} className="inline-flex">
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop the current turn"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-danger/50 text-danger hover:bg-danger-soft"
          >
            <Icon name="stop" size={12} />
          </button>
        </Tip>
      )}
      {view.cont && (
        <Tip text={<span className="flex items-center gap-1.5">{view.cont.tip} <KeyCaps spec={view.cont.keys} small /></span>} className="inline-flex">
          <button
            type="button"
            onClick={() => onAction("continue")}
            disabled={sending}
            className={`flex h-8 items-center whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40 ${TONE.neutral}`}
          >
            {view.cont.label}
          </button>
        </Tip>
      )}
      {view.done && (
        <Tip text={view.done.tip} className="inline-flex">
          <button
            type="button"
            onClick={() => onAction("done")}
            disabled={sending}
            className={`flex h-8 items-center whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40 ${TONE.neutral}`}
          >
            {view.done.label}
          </button>
        </Tip>
      )}
      <div className={`flex h-8 overflow-hidden rounded-md ${tone}`}>
        <Tip text={view.primary.tip} className="inline-flex">
          <button
            type="button"
            onClick={() => onAction(view.primary.action)}
            disabled={sending}
            aria-label={view.primary.label}
            className="flex h-8 items-center gap-1.5 px-2.5 text-[12.5px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Spinner size={12} /> : view.mode === "shell" && <Icon name="terminal" size={13} />}
            <span className="whitespace-nowrap">{view.primary.label}</span>
            <span className="font-mono text-[11px] opacity-60" aria-hidden>
              ↵
            </span>
          </button>
        </Tip>
        {view.menu.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={sending}
            aria-label="More ways to send"
            aria-expanded={open}
            className="flex h-8 items-center border-l border-current/25 px-1.5 hover:opacity-90 disabled:opacity-40"
          >
            <Icon name="chevronDown" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div role="menu" className="absolute bottom-full right-0 z-30 mb-1.5 w-60 rounded-lg border border-line-strong bg-panel p-1 text-[12.5px] shadow-lg">
          {view.menu.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAction(item.action);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-sunken focus:bg-sunken focus:outline-none"
            >
              <span>{item.label}</span>
              {item.keys && <KeyCaps spec={item.keys} small />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

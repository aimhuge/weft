"use client";

import { useEffect, useRef, useState } from "react";
import { MODE_OPTIONS, permissionOptions, type Backend, type PermissionMode } from "@/lib/types";
import { useOverlay } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";
import Icon from "./Icon";

// What the button says when a mode isn't on the list (one recorded before the list changed).
const FALLBACK = { id: "default", label: "Ask me", hint: "Asks before each tool" } as const;

function currentMode(backend: Backend, value: PermissionMode) {
  const options = permissionOptions(backend);
  return options.find((m) => m.id === value) ?? MODE_OPTIONS.find((m) => m.id === value) ?? FALLBACK;
}

function visibleModes(backend: Backend, yolo: boolean, value: PermissionMode) {
  return permissionOptions(backend).filter((m) => yolo || m.id !== "bypassPermissions" || m.id === value);
}

function titleFor(disabled: boolean, hint: string) {
  return disabled ? "Codex keeps its sandbox mode for this session. Start a new Codex session to change it." : `Permissions: ${hint}`;
}

function buttonClass(small: boolean, loose: boolean) {
  const size = small ? "gap-1 py-px pl-1.5 pr-1 text-[11px]" : "gap-1.5 py-1.5 pl-2.5 pr-1.5 text-[12px]";
  const tone = loose ? "border-warn/50 bg-warn-soft text-warn" : small ? "border-line text-muted" : "border-line-strong text-ink";
  return `flex items-center rounded-md border font-medium disabled:cursor-not-allowed ${size} ${tone}`;
}

// Open/closed, shut by Escape or a click outside `root`. The pane is a native view drawn above the
// board, so it hides while the menu is open.
function useMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useOverlay(open);
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);
  return { open, setOpen, root };
}

// The modes, each with what it does under its name.
function ModeMenu({
  options,
  value,
  up,
  end,
  onPick,
}: {
  options: { id: PermissionMode; label: string; hint: string }[];
  value: PermissionMode;
  up: boolean;
  end: boolean;
  onPick: (mode: PermissionMode) => void;
}) {
  return (
    <div
      role="menu"
      aria-label="Permissions"
      className={`absolute ${end ? "right-0" : "left-0"} z-40 w-72 rounded-lg border border-line bg-panel p-1 shadow-lg ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
    >
      {options.map((m) => (
        <button
          key={m.id}
          type="button"
          role="menuitemradio"
          aria-checked={m.id === value}
          onClick={() => onPick(m.id)}
          className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft"
        >
          <span className="mt-0.5 flex w-[13px] shrink-0 justify-center text-accent">
            {m.id === value && <Icon name="check" size={13} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-[12.5px] font-medium ${m.id === "bypassPermissions" ? "text-warn" : "text-ink"}`}>{m.label}</span>
            <span className="block text-[11.5px] leading-snug text-muted">{m.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// The permission mode picker: in the new-thread dialog, Settings → Security, and small in a thread's
// header, where a change applies to the running CLI right away. YOLO shows in the warning colour.
// A menu rather than a native select, because a native menu on macOS never shows an option's
// tooltip: here every mode says what it does under its name.
export default function ModePicker({
  value,
  onChange,
  small = false,
  yolo = true,
  backend = "claude",
  disabled = false,
  up = false,
  end = false,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  small?: boolean;
  backend?: Backend;
  disabled?: boolean;
  // Hide full access for the copilot, which cannot skip permission prompts.
  yolo?: boolean;
  // Open the menu above the button, for a picker near the bottom of its dialog.
  up?: boolean;
  // Line the menu up with the button's right edge, for a picker at the right of its row.
  end?: boolean;
}) {
  const { open, setOpen, root } = useMenu();
  const mode = currentMode(backend, value);
  const options = visibleModes(backend, yolo, value);
  const loose = value === "bypassPermissions";
  function pick(next: PermissionMode) {
    setOpen(false);
    if (next !== value) onChange(next);
  }
  return (
    <div ref={root} data-human-only className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Permissions: ${mode.label}`}
        title={titleFor(disabled, mode.hint)}
        className={buttonClass(small, loose)}
      >
        <Icon name={loose ? "zap" : "shield"} size={small ? 11 : 13} />
        <span className={small ? "pr-0.5" : "pr-1"}>{mode.label}</span>
        <Icon name="chevronDown" size={small ? 10 : 12} />
      </button>
      {open && <ModeMenu options={options} value={value} up={up} end={end} onPick={pick} />}
    </div>
  );
}

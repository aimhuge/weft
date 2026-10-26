"use client";

import { useEffect, useRef, useState } from "react";
import { cronApi } from "@/lib/cron-client";
import { inputOf, newForm } from "@/lib/cron-form";
import { effortFor } from "@/lib/new-thread";
import type { Backend, PermissionMode } from "@/lib/types";
import type { Effort } from "@/lib/types-settings";
import { useNow } from "@/lib/use-now";
import CronEditor from "./CronEditor";
import Icon from "./Icon";
import "./crons.css";

// What the New thread window has picked, for the cron's runs.
export interface NewThreadPicks {
  cwd: string;
  backend: Backend;
  permissionMode: PermissionMode;
  model?: string;
  effort?: Effort | "";
}

// The New thread window's ⏰ and ✕. The ⏰ puts the prompt being written on a cron instead of starting it once:
// each run is a fresh card with this prompt, folder, model and mode (docs/architecture/crons.md).
export default function NewThreadHeaderActions({ read, picks, onCreated, onClose }: { read: () => string; picks: NewThreadPicks; onCreated: () => void; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [runNow, setRunNow] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={root} className="relative flex items-center gap-1">
      <button type="button" onClick={() => setOpen(!open)} title="Run this on a cron" aria-label="Run on a cron" aria-expanded={open} className={`rounded-md p-1 hover:bg-sunken ${open ? "text-cron" : "text-muted hover:text-ink"}`}>
        <Icon name="clock" size={16} />
      </button>
      <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
        <Icon name="x" size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-[360px] rounded-lg border border-line-strong bg-panel p-3 shadow-lg">
          <p className="text-[13.5px] font-semibold text-ink">⏰ Run this on a cron</p>
          <p className="mt-0.5 text-[11.5px] text-faint">Each run is a new card with the prompt you&apos;re writing.</p>
          <CronEditor
            initial={newForm("", "fresh", now)}
            now={now}
            prompt={false}
            submitLabel="Create cron"
            footer={
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />
                Also run now
              </label>
            }
            onSubmit={async (form) => {
              const input = inputOf({ ...form, prompt: read() }, { ...picks, effort: effortFor(picks.backend, picks.effort), runNow, mode: "fresh" }, now);
              if ("error" in input) throw new Error(input.error === "Write what each run should do." ? "Write the prompt first." : input.error);
              await cronApi.create(input);
              setOpen(false);
              onCreated();
            }}
          />
        </div>
      )}
    </div>
  );
}

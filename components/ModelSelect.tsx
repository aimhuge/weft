"use client";

import { useState } from "react";
import { MODELS } from "@/lib/new-thread";
import { useLimitedModels } from "@/lib/use-plan-limits";
import type { Backend } from "@/lib/types";

// One optgroup per CLI a model is offered on. The whole point of grouping here is that
// Claude and Puku share some model names today and Codex will tomorrow — and a model
// added to MODELS shows up in the right group without anyone touching this file.
// A picker that only wants some groups (the Copilot picker: Claude-only) passes a `groups`
// override; the default is the full list.
const DEFAULT_GROUPS: { label: string; backends: Backend[] }[] = [
  { label: "Claude", backends: ["claude"] },
  { label: "Puku", backends: ["puku"] },
  { label: "Codex", backends: ["codex"] },
];

export const SELECT_CLASS =
  "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export type PickerOption = { value: string; label: string };

// A model's options under a heading. `groups` is the open list; omitting it means every CLI's
// models under their own heading.
export default function ModelSelect({
  value,
  label,
  leading,
  onChange,
  groups,
}: {
  value: string;
  label: string;
  leading: PickerOption[];
  onChange: (value: string) => void;
  groups?: { label: string; backends: Backend[] }[];
}) {
  const list = groups ?? DEFAULT_GROUPS;
  const limited = useLimitedModels();
  const atLimit = new Set(limited.map((l) => l.model));
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      {leading.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {list.map((g) => {
        const opts = g.backends.flatMap((b) => MODELS[b]);
        if (opts.length === 0) return null;
        return (
          <optgroup key={g.label} label={g.label}>
            {opts.map((m) => (
              <option key={m.id} value={m.id}>
                {atLimit.has(m.id) ? `${m.label} — at its limit` : m.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// A Settings value that saves as soon as it changes, and goes back with the reason if the save fails.
export function useSavedPick<T>(initial: T, save: (value: T) => Promise<unknown>) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  function pick(next: T) {
    const before = value;
    setValue(next);
    setError(null);
    save(next).catch((err: unknown) => {
      setValue(before);
      setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return [value, pick, error] as const;
}

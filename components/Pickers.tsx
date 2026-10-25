"use client";

import { EFFORTS, MODELS } from "@/lib/new-thread";
import type { Backend, Effort } from "@/lib/types";
import ModelSelect, { SELECT_CLASS, type CliPick, type PickerOption } from "./ModelSelect";

// The Models page's two small dropdowns: the model (ModelSelect, every model menu in Weft, which
// also picks the CLI when given `cli`) and the effort. They exist so callers don't repeat option
// lists and `aria-label`s.

// The model menu: optional leading options (e.g. "Card's own model") then a group per CLI. Every
// model any CLI serves is offered — a row's choice isn't limited to one CLI, and picking a model
// moves that row's CLI to the one serving it. `groups` is still
// accepted so a caller can pass it; it no longer narrows the list.
export function ModelPicker({
  value,
  onChange,
  label,
  leading = [],
  cli,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  leading?: PickerOption[];
  // The row's CLI, when this menu picks it too (Settings → Models → New threads).
  cli?: CliPick;
  // Accepted and ignored: every picker offers every model now, so narrowing a row to one CLI
  // is no longer something a caller can ask for.
  groups?: { label: string; backends: Backend[] }[];
}) {
  return <ModelSelect value={value} label={label} leading={leading} onChange={onChange} cli={cli} />;
}

// The effort menu. `leading` defaults to "Card's own effort" for the /weft:done row and to
// "Default effort" for the new-threads row; pass `leading={null}` to skip it.
export function EffortPicker({
  value,
  onChange,
  label,
  leading,
}: {
  value: Effort | "";
  onChange: (next: Effort | "") => void;
  label: string;
  leading?: PickerOption | null;
}) {
  const head: PickerOption[] = leading === undefined ? [{ value: "", label: "Default effort" }] : leading === null ? [] : [leading];
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as Effort | "")}
      className={SELECT_CLASS}
    >
      {head.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {EFFORTS.filter((e) => e.id !== "").map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
    </select>
  );
}

// Re-export MODELS so callers can pick which backends a ModelPicker shows.
export { MODELS };

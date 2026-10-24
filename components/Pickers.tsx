"use client";

import { BACKENDS, EFFORTS, MODELS } from "@/lib/new-thread";
import type { Backend, Effort } from "@/lib/types";
import ModelSelect, { SELECT_CLASS, type PickerOption } from "./ModelSelect";

// Three small dropdowns the Models page shares: the CLI (backend), the model (the grouped
// Claude/Puku/Codex picker), and the effort. Each renders the same `<select>` and the same
// SELECT_CLASS; the only reason they exist is so callers don't repeat option lists and
// `aria-label`s. ModelSelect already groups Claude + Puku + Codex, so a model picker just
// wraps it. BackendPicker and EffortPicker wrap a flat list.

// What a backend picker is allowed to show. The New threads row only offers the installed ones.
export function BackendPicker({
  value,
  onChange,
  label = "Default CLI",
  available,
}: {
  value: Backend;
  onChange: (next: Backend) => void;
  label?: string;
  available?: Backend[];
}) {
  const list = available ?? BACKENDS.map((b) => b.id);
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as Backend)}
      className={SELECT_CLASS}
    >
      {list.map((id) => (
        <option key={id} value={id}>
          {BACKENDS.find((x) => x.id === id)?.label ?? id}
        </option>
      ))}
    </select>
  );
}

// The model menu: optional leading options (e.g. "Card's own model") then a Claude / Puku /
// Codex group. Every model any CLI serves is offered — a row's choice isn't limited to one
// CLI, and picking a model moves that row's CLI to the one serving it. `groups` is still
// accepted so a caller can pass it; it no longer narrows the list.
export function ModelPicker({
  value,
  onChange,
  label,
  leading = [],
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  leading?: PickerOption[];
  // Accepted and ignored: every picker offers every model now, so narrowing a row to one CLI
  // is no longer something a caller can ask for.
  groups?: { label: string; backends: Backend[] }[];
}) {
  return <ModelSelect value={value} label={label} leading={leading} onChange={onChange} />;
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

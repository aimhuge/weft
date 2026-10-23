import type { VercelEnvRow } from "./vercel-view";

// The ▲ drawer's 🔐 list filter: a name search plus which state the row is in, one per RowAction label.
export type EnvState = "all" | "push" | "onVercel" | "vercelOnly" | "noValue";

export const ENV_STATES: { id: EnvState; label: string }[] = [
  { id: "all", label: "All" },
  { id: "push", label: "To push" },
  { id: "onVercel", label: "On Vercel" },
  { id: "vercelOnly", label: "Vercel only" },
  { id: "noValue", label: "No value" },
];

export function envState(row: VercelEnvRow): Exclude<EnvState, "all"> {
  if (row.inVault) return row.onVercel ? "onVercel" : "push";
  return row.onVercel ? "vercelOnly" : "noValue";
}

// Rows whose name holds every word of the query (any case, any order) and match the state.
export function filterEnvRows(rows: VercelEnvRow[], query: string, state: EnvState) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => (state === "all" || envState(r) === state) && words.every((w) => r.name.toLowerCase().includes(w)));
}

// How many rows each state holds, for the menu's labels.
export function stateCounts(rows: VercelEnvRow[]): Record<EnvState, number> {
  const counts: Record<EnvState, number> = { all: rows.length, push: 0, onVercel: 0, vercelOnly: 0, noValue: 0 };
  for (const r of rows) counts[envState(r)]++;
  return counts;
}

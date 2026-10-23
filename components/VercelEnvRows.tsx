"use client";

import { useState, type ReactNode } from "react";
import { ENV_STATES, filterEnvRows, stateCounts, type EnvState } from "@/lib/vercel-env-filter";
import type { VercelEnvRow } from "@/lib/vercel-view";

// Short lists need no filter.
const FILTER_FROM = 5;

// The ▲ drawer's 🔐 list (components/VercelEnv.tsx), under a name search and a state menu once it's long enough to need them; footer stays below whatever matches.
export default function VercelEnvRows({ rows, footer, children }: { rows: VercelEnvRow[]; footer?: ReactNode; children: (rows: VercelEnvRow[]) => ReactNode }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<EnvState>("all");
  const shown = filterEnvRows(rows, query, state);
  return (
    <>
      {rows.length > FILTER_FROM && <EnvFilter rows={rows} query={query} onQuery={setQuery} state={state} onState={setState} />}
      <ul className="mt-1 space-y-0.5">
        {shown.length === 0 && <li className="text-[10px] text-faint">No variables match</li>}
        {children(shown)}
        {footer}
      </ul>
    </>
  );
}

// The menu's counts are for the whole list, so a state with nothing in it is greyed out.
function EnvFilter({ rows, query, onQuery, state, onState }: { rows: VercelEnvRow[]; query: string; onQuery: (q: string) => void; state: EnvState; onState: (s: EnvState) => void }) {
  const counts = stateCounts(rows);
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !query) return;
          e.stopPropagation();
          onQuery("");
        }}
        placeholder="Filter variables"
        aria-label="Filter variables"
        className="min-w-0 flex-1 rounded border border-line bg-transparent px-1.5 font-mono text-[10.5px] leading-[18px] text-ink placeholder:text-faint focus:outline-none"
      />
      <select value={state} onChange={(e) => onState(e.target.value as EnvState)} aria-label="Show" className="shrink-0 rounded border border-line bg-transparent px-1 text-[10px] leading-[18px] text-faint hover:text-ink">
        {ENV_STATES.map((s) => (
          <option key={s.id} value={s.id} disabled={s.id !== "all" && counts[s.id] === 0}>
            {s.label} ({counts[s.id]})
          </option>
        ))}
      </select>
    </div>
  );
}

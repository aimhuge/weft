"use client";

// One agent's row in Settings → Agents (docs/architecture/agents.md): its emoji, name and line, its marks, and what you
// can do with it. A built-in edits, duplicates and resets; one you made edits, duplicates, deletes and shares with your
// teams; a team's agent (shared by a teammate) only shows and duplicates.
import { useState } from "react";
import type { AgentInfo, TeamRef } from "@/lib/agents";
import { api } from "@/lib/client";
import { errorText } from "@/lib/new-thread";
import { showAgents } from "@/lib/use-agents";

export const LINK = "text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline";

// What a built-in's mark says: you changed it, or Reset brought GitHub's newer text.
const CHANGED = { you: "Edited", github: "Latest from GitHub" } as const;

export interface AgentRowActions {
  onEdit: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onDelete: () => void;
}

export default function SettingsAgentRow({ agent: a, teams, sharedWith, actions }: {
  agent: AgentInfo;
  // Your teams, and the ones this agent is shared with (empty for a built-in or a team's agent).
  teams: TeamRef[];
  sharedWith: string[];
  actions: AgentRowActions;
}) {
  const own = !a.builtIn && !a.team;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="text-[18px] leading-none">{a.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            {a.name}
            {a.builtIn && <span className="rounded border border-line px-1.5 text-[10.5px] font-normal text-faint">Built in</span>}
            {a.team && <span className="rounded border border-line px-1.5 text-[10.5px] font-normal text-faint" title={`Shared by a teammate in ${a.team.name}`}>{a.team.name}</span>}
            {a.changed && <span className="text-[11px] font-normal text-accent">{CHANGED[a.changed]}</span>}
          </div>
          {a.tagline && <p className="truncate text-[12px] text-muted">{a.tagline}</p>}
        </div>
        <div className="flex shrink-0 gap-3">
          <button type="button" className={LINK} onClick={actions.onEdit}>{a.team ? "View" : "Edit"}</button>
          <button type="button" className={LINK} onClick={actions.onDuplicate}>Duplicate</button>
          {a.builtIn && <button type="button" className={LINK} title="Pull its latest text from Weft's repo on GitHub" onClick={actions.onReset}>Reset</button>}
          {own && <button type="button" className={LINK} onClick={actions.onDelete}>Delete</button>}
        </div>
      </div>
      {own && teams.length > 0 && <TeamShares agent={a} teams={teams} sharedWith={sharedWith} />}
    </div>
  );
}

// The teams one of yours is shared with, each with ✕ to stop, and a menu to share it with another. Every member of a
// team it's shared with gets it in their pickers; an edit you make here reaches them on their next pull.
function TeamShares({ agent, teams, sharedWith }: { agent: AgentInfo; teams: TeamRef[]; sharedWith: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (call: Promise<Parameters<typeof showAgents>[0]>) => {
    setBusy(true);
    setError(null);
    void call.then(showAgents, (err: unknown) => setError(errorText(err))).finally(() => setBusy(false));
  };
  const shared = teams.filter((t) => sharedWith.includes(t.id));
  const rest = teams.filter((t) => !sharedWith.includes(t.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-[30px] text-[12px]">
      {shared.map((t) => (
        <span key={t.id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-muted">
          Shared with {t.name}
          <button type="button" disabled={busy} aria-label={`Stop sharing ${agent.name} with ${t.name}`} className="text-faint hover:text-ink"
            onClick={() => run(api.unshareAgent(agent.id, t.id))}>✕</button>
        </span>
      ))}
      {rest.length > 0 && (
        <select aria-label={`Share ${agent.name} with a team`} value="" disabled={busy} onChange={(e) => e.target.value && run(api.shareAgent(agent.id, e.target.value))}
          className="rounded-md border border-line-strong bg-canvas px-1.5 py-0.5 text-[12px] text-muted">
          <option value="">Share with…</option>
          {rest.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

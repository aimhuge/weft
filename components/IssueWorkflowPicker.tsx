"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { LANDING_LABELS } from "@/lib/issue-landing";
import type { IssueWorkflow } from "@/lib/github-view";

// Where a new issue's card lands, and how a "run" card works: the skill that validates it first and
// the agent that does the work (lib/issue-landing.ts).
//
// It sits beside the drawer's folder section, so it has its own file: the drawer is already at its
// line cap, and this part grows on its own (a third picker, another answer).

export default function IssueWorkflowPicker({
  workflow,
  folder,
  busy,
  designed,
  onChange,
  onDesignAgent,
}: {
  workflow: IssueWorkflow;
  folder: string;
  busy: boolean;
  // This project already has a design thread, so the button stays off.
  designed: boolean;
  onChange: (workflow: IssueWorkflow) => void;
  // Starts the thread that designs the agent, and opens it (lib/agent-thread.ts).
  onDesignAgent: (folder: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState<"skill" | "agent" | null>(null);
  const runs = workflow.landing === "run";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-faint" title="Where a new issue's card lands">
          Land in
        </span>
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Where issue cards land">
          {LANDING_LABELS.map((option) => {
            const on = option.id === workflow.landing;
            return (
              <button
                key={option.id}
                onClick={() => !on && onChange({ ...workflow, landing: option.id })}
                disabled={busy}
                title={option.hint}
                aria-pressed={on}
                className={`px-1.5 py-0.5 text-[10.5px] transition-colors disabled:opacity-40 ${
                  on ? "bg-accent text-on-accent" : "text-muted hover:bg-sunken hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {runs && (
        <div className="space-y-1 pl-1">
          <PickRow
            label="Checks with"
            value={workflow.skill ?? "Nothing"}
            title="The skill that runs as the card's first turn: it validates the issue before any work happens."
            disabled={busy}
            onClick={() => setPicking(picking === "skill" ? null : "skill")}
          />
          <PickRow
            label="Works as"
            value={workflow.agent ?? "The default agent"}
            title="Who works the card: an agent from Settings → Agents, or the project's default."
            disabled={busy}
            onClick={() => setPicking(picking === "agent" ? null : "agent")}
          />
          <DesignAgentButton folder={folder} busy={busy} designed={designed} onDesign={onDesignAgent} />
          {picking === "skill" && <SkillPicker folder={folder} busy={busy} onPick={(skill) => { setPicking(null); onChange({ ...workflow, skill }); }} />}
          {picking === "agent" && <AgentPicker busy={busy} onPick={(agent) => { setPicking(null); onChange({ ...workflow, agent }); }} />}
        </div>
      )}
    </div>
  );
}

function PickRow({ label, value, title, disabled, onClick }: { label: string; value: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="flex max-w-full items-center gap-1.5 text-left disabled:opacity-40">
      <span className="text-faint">{label}</span>
      <span className="truncate text-ink underline decoration-dotted underline-offset-2">{value}</span>
    </button>
  );
}

// The skills a card in this project can run: Weft's own, yours in ~/.claude/skills, and the folder's.
function SkillPicker({ folder, busy, onPick }: { folder: string; busy: boolean; onPick: (skill: string) => void }) {
  const [skills, setSkills] = useState<{ name: string; description?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (skills === null && error === null) {
    void api
      .skills(folder)
      .then((r) => setSkills(r.skills))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }
  if (error) return <p className="text-danger">{error}</p>;
  if (!skills) return <p className="text-faint">Looking for skills…</p>;
  if (!skills.length) return <p className="text-faint">No skills to check with. Put one in the project&apos;s .claude/skills.</p>;
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-line bg-sunken">
      <button onClick={() => onPick("")} disabled={busy} className="block w-full px-2 py-1 text-left text-[11px] text-muted hover:bg-card hover:text-ink">
        Nothing — the card starts on the issue itself
      </button>
      {skills.map((s) => (
        <button key={s.name} onClick={() => onPick(s.name)} disabled={busy} title={s.description} className="block w-full px-2 py-1 text-left text-[11px] text-ink hover:bg-card">
          {s.name}
        </button>
      ))}
    </div>
  );
}

// The agents a card can work as: the ones in Settings → Agents.
function AgentPicker({ busy, onPick }: { busy: boolean; onPick: (agent: string) => void }) {
  const [agents, setAgents] = useState<{ id: string; name: string; emoji?: string; tagline?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (agents === null && error === null) {
    void api
      .agents()
      .then((r) => setAgents(r.agents))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }
  if (error) return <p className="text-danger">{error}</p>;
  if (!agents) return <p className="text-faint">Looking for agents…</p>;
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-line bg-sunken">
      <button onClick={() => onPick("")} disabled={busy} className="block w-full px-2 py-1 text-left text-[11px] text-muted hover:bg-card hover:text-ink">
        The default agent
      </button>
      {agents.map((a) => (
        <button key={a.id} onClick={() => onPick(a.id)} disabled={busy} title={a.tagline} className="block w-full px-2 py-1 text-left text-[11px] text-ink hover:bg-card">
          {a.emoji ? `${a.emoji} ` : ""}
          {a.name}
        </button>
      ))}
    </div>
  );
}

// The button that starts the thread which designs the agent (lib/agent-thread.ts). The thread asks
// the questions itself — one at a time — and writes the soul from the answers. Weft's part is the
// brief and the page the thread opens on.
//
// It goes off once the thread is made: the thread is on the board and open, and a second click
// would make a second one.
function DesignAgentButton({ folder, busy, designed, onDesign }: { folder: string; busy: boolean; designed: boolean; onDesign: (folder: string) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-0.5">
      <button
        onClick={() => {
          setError(null);
          void onDesign(folder).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}
        disabled={busy || designed}
        title={designed ? "This project already has a thread designing its agent" : "Starts a thread that asks what the agent should do, then writes its soul"}
        className="text-[11px] text-accent underline decoration-dotted underline-offset-2 disabled:opacity-40"
      >
        Design the agent
      </button>
      {error && <p className="text-[10.5px] text-danger">{error}</p>}
    </div>
  );
}

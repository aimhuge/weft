"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { LANDING_LABELS } from "@/lib/issue-landing";
import type { IssueWorkflow } from "@/lib/github-view";
import type { InterviewQuestion } from "@/lib/types";

// Where a new issue's card lands, and how a "run" card works: the skill that validates it first and
// the agent that does the work (lib/issue-landing.ts).
//
// It sits beside the drawer's folder section, so it has its own file: the drawer is already at its
// line cap, and this part grows on its own (a third picker, another answer).

export default function IssueWorkflowPicker({
  workflow,
  folder,
  busy,
  onChange,
}: {
  workflow: IssueWorkflow;
  folder: string;
  busy: boolean;
  onChange: (workflow: IssueWorkflow) => void;
}) {
  const [picking, setPicking] = useState<"skill" | "agent" | "design" | null>(null);
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
          <button
            onClick={() => setPicking(picking === "design" ? null : "design")}
            disabled={busy}
            title="Answer a few questions and Weft writes the agent: the one that checks an issue before the work starts"
            className="text-[11px] text-accent underline decoration-dotted underline-offset-2 disabled:opacity-40"
          >
            Design the agent
          </button>
          {picking === "skill" && <SkillPicker folder={folder} busy={busy} onPick={(skill) => { setPicking(null); onChange({ ...workflow, skill }); }} />}
          {picking === "agent" && <AgentPicker busy={busy} onPick={(agent) => { setPicking(null); onChange({ ...workflow, agent }); }} />}
          {picking === "design" && (
            <AgentInterview
              busy={busy}
              onClose={() => setPicking(null)}
              onDone={(agent) => {
                setPicking(null);
                onChange({ ...workflow, agent: agent.id });
              }}
            />
          )}
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

// The interview that designs the validating agent (lib/agent-interview.ts): a few questions, and
// the agent they make, saved and picked as the card's agent.
function AgentInterview({ busy, onClose, onDone }: { busy: boolean; onClose: () => void; onDone: (agent: { id: string; name: string }) => void }) {
  const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    void api
      .interviewQuestions()
      .then((r) => alive && setQuestions(r.questions))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <p className="text-danger">{error}</p>;
  if (!questions) return <p className="text-faint">Asking…</p>;
  const named = questions.every((q) => answers[q.key]?.trim());
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-sunken p-2">
      {questions.map((q) => (
        <div key={q.key}>
          <p className="text-[11px] font-medium text-ink">{q.ask}</p>
          {q.hint && <p className="text-[10.5px] text-faint">{q.hint}</p>}
          {q.options ? (
            <div className="mt-0.5 flex flex-wrap gap-1">
              {q.options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: o.value }))}
                  title={o.description}
                  className={`rounded-md border px-1.5 py-0.5 text-[10.5px] ${
                    answers[q.key] === o.value ? "border-accent bg-accent text-on-accent" : "border-line text-muted hover:text-ink"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <input
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
              placeholder="Validator"
              className="mt-0.5 w-full rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] text-ink"
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={() => {
            setSaving(true);
            void api
              .saveInterviewedAgent(answers)
              .then((r) => onDone(r.agent))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setSaving(false));
          }}
          disabled={busy || saving || !named}
          className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40"
        >
          {saving ? "Saving…" : "Make the agent"}
        </button>
        <button onClick={onClose} className="text-[11px] text-faint hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

"use client";

// One agent's form in Settings → Agents (docs/architecture/agents.md): its emoji, name, one line, soul and, once it
// exists, its skills. A built-in's edit is saved over the one that shipped; Reset in the list brings it back.
import { useEffect, useState } from "react";
import type { AgentInfo } from "@/lib/agents";
import { api, type AgentDraft } from "@/lib/client";
import { errorText } from "@/lib/new-thread";
import { refreshAgents } from "@/lib/use-agents";
import type { SkillSetView } from "@/lib/types";
import SkillSetList from "./SkillSetList";
import { BUTTON_PRIMARY } from "./button-styles";

const FIELD = "rounded-md border border-line-strong bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

// What a new agent's soul starts as: a sketch to write over.
export const STARTER_SOUL =
  "This system prompt comes from Weft, and you are …. Say who this thread is, what it's for and how it works: what it reads first, what it makes, and how it shows its work in the browser pane. You keep every tool a Weft thread has. In any project, read its own CLAUDE.md, AGENTS.md and SOUL.md when present.";

export default function AgentEditor({ agent, seed, onDone }: {
  // The agent being edited; left out, the form makes a new one from seed.
  agent?: AgentInfo;
  seed?: AgentDraft;
  onDone: () => void;
}) {
  const from = agent ?? seed ?? { name: "", emoji: "", tagline: "", soul: STARTER_SOUL };
  const [draft, setDraft] = useState<AgentDraft>({ name: from.name, emoji: from.emoji, tagline: from.tagline, soul: from.soul });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof AgentDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (agent) await api.updateAgent(agent.id, draft);
      else await api.createAgent(draft);
      await refreshAgents();
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-canvas/60 p-3">
      <div className="flex gap-2">
        <input aria-label="Emoji" value={draft.emoji} onChange={set("emoji")} placeholder="🤖" className={`${FIELD} w-12 text-center`} />
        <input aria-label="Name" value={draft.name} onChange={set("name")} placeholder="Name, like Reviewer" className={`${FIELD} min-w-0 flex-1`} />
      </div>
      <input aria-label="One line" value={draft.tagline} onChange={set("tagline")} placeholder="One line: what it’s for" className={FIELD} />
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-muted">Soul: the start of every system prompt this agent’s threads get</span>
        <textarea aria-label="Soul" value={draft.soul} onChange={set("soul")} rows={12}
          className={`${FIELD} resize-y font-mono text-[12px] leading-relaxed`} />
      </label>
      {agent ? <AgentSkills id={agent.id} /> : <p className="text-[12px] text-faint">Add the agent first, then pick its skills here.</p>}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:text-ink">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void save()}
          className={BUTTON_PRIMARY}>
          {agent ? "Save agent" : "Add agent"}
        </button>
      </div>
    </div>
  );
}

// The skills this agent’s threads get: Weft's, yours and your plugins, each on unless the agent turns it off. The
// project's own skills follow the project's set. A switch applies at once.
function AgentSkills({ id }: { id: string }) {
  const [view, setView] = useState<SkillSetView | null>(null);
  useEffect(() => {
    api.skillSet({ agent: id }).then(setView, () => {});
  }, [id]);
  const toggle = (name: string, on: boolean) =>
    void api.setSkill({ agent: id }, name, on).then((next) => {
      setView(next);
      void refreshAgents();
    }, () => {});
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-muted">Skills: what its threads get, on top of each project&apos;s own set</span>
      <div className="flex h-64 flex-col overflow-hidden rounded-md border border-line-strong bg-canvas">
        <SkillSetList view={view} forCard={false} onToggle={toggle} />
      </div>
    </div>
  );
}

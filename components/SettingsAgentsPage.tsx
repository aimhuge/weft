"use client";

// Settings → Agents (docs/architecture/agents.md): who your threads are. Every agent, built-ins first and your teams'
// last; a built-in resets to its latest text from Weft's repo on GitHub, one you made can be deleted or shared with a
// team (components/SettingsAgentRow.tsx). Below, each project's default agent. Changes apply as you make them, like
// Shortcuts: nothing waits for Save.
import { useState } from "react";
import { agentLabel, type AgentInfo } from "@/lib/agents";
import { api, type AgentDraft } from "@/lib/client";
import { folderName } from "@/lib/format";
import { errorText } from "@/lib/new-thread";
import { refreshAgents, showAgents, useAgentList } from "@/lib/use-agents";
import { useWorkerProjectsOnce } from "@/lib/use-worker-projects-once";
import AgentEditor, { STARTER_SOUL } from "./AgentEditor";
import AgentBuilder from "./AgentBuilder";
import SettingsAgentRow, { LINK } from "./SettingsAgentRow";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";

export default function SettingsAgentsPage({ projects }: { projects: string[] }) {
  const { agents, projects: defaults, teams, shares } = useAgentList();
  // The agent whose form is open, or "new" with what it starts from.
  const [open, setOpen] = useState<{ id: string } | { seed: AgentDraft } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Delete and Reset: one call, then the list again, and what happened said under it.
  const act = (run: () => Promise<string>) =>
    void run().then(async (said) => {
      await refreshAgents();
      setNote(said);
    }, (err: unknown) => setNote(errorText(err)));
  const reset = (a: AgentInfo) => act(async () => {
    const { from } = await api.resetAgent(a.id);
    return from === "github" ? `${a.name} is back to the latest from GitHub.` : `GitHub couldn't be reached, so ${a.name} is back to the text Weft shipped with.`;
  });
  const remove = (a: AgentInfo) => {
    if (window.confirm(`Delete ${a.name}? Its threads go back to Builder.`)) act(async () => (await api.deleteAgent(a.id), `Deleted ${a.name}.`));
  };
  const duplicate = (a: AgentInfo) => setOpen({ seed: { name: `${a.name} copy`, emoji: a.emoji, tagline: a.tagline, soul: a.soul } });

  return (
    <>
      <SettingsCard>
        <SettingsSectionHeader
          title="Agents"
          hint="An agent is who a thread is: its soul is the start of the thread's system prompt, and it can turn skills off. Pick one in the New thread dialog, or right-click a card to switch."
        />
        <ul className="flex flex-col gap-2">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-col gap-2">
              <SettingsAgentRow agent={a} teams={teams} sharedWith={shares[a.id] ?? []} actions={{
                onEdit: () => setOpen(open && "id" in open && open.id === a.id ? null : { id: a.id }),
                onDuplicate: () => duplicate(a),
                onReset: () => reset(a),
                onDelete: () => remove(a),
              }} />
              {open && "id" in open && open.id === a.id && <AgentEditor key={a.id} agent={a} onDone={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
        {open && "seed" in open
          ? <AgentEditor seed={open.seed} onDone={() => setOpen(null)} />
          : <button type="button" className={`${LINK} self-start`} onClick={() => setOpen({ seed: { name: "", emoji: "", tagline: "", soul: STARTER_SOUL } })}>+ New agent</button>}
        <AgentBuilder onSpawned={() => void refreshAgents()} />
        {note && <p className="text-[12.5px] text-muted">{note}</p>}
      </SettingsCard>
      <ProjectDefaults agents={agents} defaults={defaults} projects={projects} />
    </>
  );
}

// Each project's default agent: a new thread there starts as it, and so does one a thread or the copilot starts there
// without naming an agent.
// A worker project's default goes to that worker with your agents (lib/agent-sync.ts), named "folder · worker" here.
function ProjectDefaults({ agents, defaults, projects }: { agents: AgentInfo[]; defaults: Record<string, string>; projects: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const workers = useWorkerProjectsOnce();
  const folders = [...new Set([...projects, ...workers.map((w) => w.path), ...Object.keys(defaults)])];
  const label = (cwd: string) => {
    const worker = workers.find((w) => w.path === cwd);
    return worker ? `${worker.folder} · ${worker.worker}` : folderName(cwd);
  };
  const pick = (cwd: string, id: string) =>
    void api.setProjectAgent(cwd, id === "builder" ? null : id).then((r) => showAgents(r), (err: unknown) => setError(errorText(err)));
  return (
    <SettingsCard>
      <SettingsSectionHeader title="Each project's default" hint="The agent a new thread in that project starts as. You can still pick another in the New thread dialog." />
      {!folders.length && <p className="text-[12.5px] text-faint">Your projects show here once you’ve started a thread in one.</p>}
      <ul className="flex flex-col gap-1.5">
        {folders.map((cwd) => (
          <li key={cwd} className="flex items-center justify-between gap-4">
            <span className="truncate text-[13px] text-ink" title={cwd}>{label(cwd)}</span>
            <select aria-label={`Default agent for ${label(cwd)}`} value={defaults[cwd] ?? "builder"} onChange={(e) => pick(cwd, e.target.value)}
              className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink">
              {agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </SettingsCard>
  );
}

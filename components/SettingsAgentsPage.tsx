"use client";

// Settings → Agents (docs/architecture/agents.md): who your threads are. Every agent, built-ins first, each editable;
// a built-in resets to its latest text from Weft's repo on GitHub, one you made can be deleted. Below, each project's
// default agent. Changes apply as you make them, like Shortcuts: nothing waits for Save.
import { useState } from "react";
import type { AgentInfo } from "@/lib/agents";
import { api, type AgentDraft } from "@/lib/client";
import { folderName } from "@/lib/format";
import { errorText } from "@/lib/new-thread";
import { refreshAgents, showAgents, useAgentList } from "@/lib/use-agents";
import AgentEditor, { STARTER_SOUL } from "./AgentEditor";
import AgentBuilder from "./AgentBuilder";
import { SettingsCard, SettingsSectionHeader } from "./SettingsLayout";

const LINK = "text-[12.5px] text-accent hover:underline disabled:text-faint disabled:no-underline";

// What a built-in's mark says: you changed it, or Reset brought GitHub's newer text.
const CHANGED = { you: "Edited", github: "Latest from GitHub" } as const;

export default function SettingsAgentsPage({ projects }: { projects: string[] }) {
  const { agents, projects: defaults } = useAgentList();
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
              <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                <span className="text-[18px] leading-none">{a.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    {a.name}
                    {a.builtIn && <span className="rounded border border-line px-1.5 text-[10.5px] font-normal text-faint">Built in</span>}
                    {a.changed && <span className="text-[11px] font-normal text-accent">{CHANGED[a.changed]}</span>}
                  </div>
                  {a.tagline && <p className="truncate text-[12px] text-muted">{a.tagline}</p>}
                </div>
                <div className="flex shrink-0 gap-3">
                  <button type="button" className={LINK} onClick={() => setOpen(open && "id" in open && open.id === a.id ? null : { id: a.id })}>Edit</button>
                  <button type="button" className={LINK} onClick={() => duplicate(a)}>Duplicate</button>
                  {a.builtIn
                    ? <button type="button" className={LINK} title="Pull its latest text from Weft's repo on GitHub" onClick={() => reset(a)}>Reset</button>
                    : <button type="button" className={LINK} onClick={() => remove(a)}>Delete</button>}
                </div>
              </div>
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
function ProjectDefaults({ agents, defaults, projects }: { agents: AgentInfo[]; defaults: Record<string, string>; projects: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const folders = [...new Set([...projects, ...Object.keys(defaults)])];
  const pick = (cwd: string, id: string) =>
    void api.setProjectAgent(cwd, id === "builder" ? null : id).then((r) => showAgents(r), (err: unknown) => setError(errorText(err)));
  return (
    <SettingsCard>
      <SettingsSectionHeader title="Each project's default" hint="The agent a new thread in that project starts as. You can still pick another in the New thread dialog." />
      {!folders.length && <p className="text-[12.5px] text-faint">Your projects show here once you’ve started a thread in one.</p>}
      <ul className="flex flex-col gap-1.5">
        {folders.map((cwd) => (
          <li key={cwd} className="flex items-center justify-between gap-4">
            <span className="truncate text-[13px] text-ink" title={cwd}>{folderName(cwd)}</span>
            <select aria-label={`Default agent for ${folderName(cwd)}`} value={defaults[cwd] ?? "builder"} onChange={(e) => pick(cwd, e.target.value)}
              className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink">
              {agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
            </select>
          </li>
        ))}
      </ul>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </SettingsCard>
  );
}

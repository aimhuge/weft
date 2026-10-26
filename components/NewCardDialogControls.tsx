"use client";

// The New thread dialog's controls row: folder picker, agent picker (who the thread is, lib/agents.ts), model picker
// (which also picks the CLI), effort picker, and the permission mode picker. Extracted from NewCardDialog.tsx so the dialog body and the controls can change on
// their own schedule.

import type { Backend, Effort, PermissionMode } from "@/lib/types";
import { EFFORTS } from "@/lib/new-thread";
import { AGENT_ORDER, AGENTS, type ThreadAgent } from "@/lib/agents";
import { unguardedNotice } from "@/lib/unguarded";
import ModelSelect from "./ModelSelect";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import RepoPicker from "./RepoPicker";
import IsolateToggle from "./IsolateToggle";

// A select inside a bordered label that draws the box and chevron itself.
const BARE_SELECT = "cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none";

export function NewCardDialogControls({
  cwd,
  home,
  backend,
  model,
  effort,
  permissionMode,
  onChooseFolder,
  onPickModel,
  onPickCli,
  onPickEffort,
  onPickMode,
  isolate,
  agent,
}: {
  cwd: string;
  home: string;
  backend: Backend;
  model: string;
  effort: Effort | "";
  permissionMode: PermissionMode;
  onChooseFolder: (folder: string) => void;
  onPickModel: (model: string) => void;
  onPickCli: (backend: Backend) => void;
  onPickEffort: (effort: Effort | "") => void;
  onPickMode: (mode: PermissionMode) => void;
  // The Isolated switch (components/IsolateToggle.tsx); left out where isolation isn't offered.
  isolate?: { on: boolean; suggest: boolean; onToggle: () => void };
  // The agent picker; left out where the thread's agent isn't picked here.
  agent?: { value: ThreadAgent; onPick: (agent: ThreadAgent) => void };
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
      <RepoPicker value={cwd} home={home} onChange={onChooseFolder} />
      {isolate && <IsolateToggle {...isolate} />}
      {agent && <AgentSelect {...agent} />}

      <label className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink">
        <span className="sr-only">Model</span>
        <ModelSelect
          value={model}
          label="Model"
          onChange={onPickModel}
          cli={{ backend, onPick: onPickCli }}
          className={BARE_SELECT}
        />
        <Icon
          name="chevronDown"
          size={12}
          className="pointer-events-none absolute right-1.5"
        />
      </label>

      {backend !== "puku" && (
        <label
          className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink"
          title="How hard the model thinks before answering"
        >
          <span className="sr-only">Effort</span>
          <select
            value={effort}
            onChange={(e) => onPickEffort(e.target.value as Effort | "")}
            className={BARE_SELECT}
          >
            {EFFORTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <Icon
            name="chevronDown"
            size={12}
            className="pointer-events-none absolute right-1.5"
          />
        </label>
      )}

      <ModePicker
        backend={backend}
        value={permissionMode}
        onChange={onPickMode}
        up
      />
      {/* Only when the picked CLI runs without Weft's guards, so it costs no room otherwise (lib/unguarded.ts). */}
      {unguardedNotice(backend) && (
        <p role="note" className="basis-full text-[11px] leading-snug text-warn">
          {unguardedNotice(backend)}
        </p>
      )}
    </div>
  );
}

// Who the thread is: its soul opens its system prompt (lib/agents.ts). Builder is Weft's own; Copywriter writes in Weft's voice.
function AgentSelect({ value, onPick }: { value: ThreadAgent; onPick: (agent: ThreadAgent) => void }) {
  return (
    <label
      className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink"
      title={`Agent: ${AGENTS[value].tagline}`}
    >
      <span className="sr-only">Agent</span>
      <select value={value} onChange={(e) => onPick(e.target.value as ThreadAgent)} className={BARE_SELECT}>
        {AGENT_ORDER.map((id) => (
          <option key={id} value={id}>
            {AGENTS[id].emoji} {AGENTS[id].name}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
    </label>
  );
}

"use client";

// The New thread dialog's model picker and the controls below the composer.

import { useUiText } from "@/lib/ui-language";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import { EFFORTS } from "@/lib/new-thread";
import { agentLabel, agentOf, type ThreadAgent } from "@/lib/agents";
import { useAgents } from "@/lib/use-agents";
import ModelSelect from "./ModelSelect";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import RepoPicker from "./RepoPicker";
import IsolateMenu, { type IsolatePick } from "./IsolateMenu";

// A select inside a bordered label that draws the box and chevron itself.
const BARE_SELECT = "cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none";

export function NewThreadModelPicker({ cwd, backend, model, onPickModel, onPickCli }: {
  cwd: string;
  backend: Backend;
  model: string;
  onPickModel: (model: string) => void;
  onPickCli: (backend: Backend) => void;
}) {
  const t = useUiText();
  return (
    <label data-human-only className="flex max-w-56 items-center rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink">
      <span className="sr-only">{t("Model")}</span>
      <ModelSelect
        value={model}
        label={t("Model")}
        onChange={onPickModel}
        cli={{ backend, onPick: onPickCli }}
        className={BARE_SELECT}
        cwd={cwd}
      />
    </label>
  );
}

export function NewCardDialogControls({
  cwd,
  home,
  backend,
  effort,
  permissionMode,
  onChooseFolder,
  onPickEffort,
  onPickMode,
  isolate,
  agent,
}: {
  cwd: string;
  home: string;
  backend: Backend;
  effort: Effort | "";
  permissionMode: PermissionMode;
  onChooseFolder: (folder: string) => void;
  onPickEffort: (effort: Effort | "") => void;
  onPickMode: (mode: PermissionMode) => void;
  // Shared or a worktree, and its branch (components/IsolateMenu.tsx); left out where isolation isn't offered.
  isolate?: IsolatePick;
  // The agent picker; left out where the thread's agent isn't picked here.
  agent?: AgentPick;
}) {
  const t = useUiText();
  // The folder, agent and mode decide what the thread may touch: a thread driving the board (board_view) can't set them.
  return (
    <div data-human-only className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
      <RepoPicker value={cwd} home={home} onChange={onChooseFolder} />
      {isolate && <IsolateMenu cwd={cwd} {...isolate} />}
      {agent && <AgentSelect {...agent} />}

      {backend !== "puku" && (
        <label
          className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink"
          title={t("How hard the model thinks before answering")}
        >
          <span className="sr-only">{t("Effort")}</span>
          <select
            value={effort}
            onChange={(e) => onPickEffort(e.target.value as Effort | "")}
            className={BARE_SELECT}
          >
            {EFFORTS.map((e) => (
              <option key={e.id} value={e.id}>
                {t(e.label)}
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
    </div>
  );
}

type AgentPick = { value: ThreadAgent; onPick: (agent: ThreadAgent) => void; onManage?: () => void };

// The Agent menu's last row: Settings → Agents, where you make and edit them.
const MANAGE = "__manage";

// Who the thread is: its soul opens its system prompt (lib/agents.ts). Builder is Weft's own, Copywriter writes in Weft's
// voice, and the ones you made in Settings → Agents follow.
function AgentSelect({ value, onPick, onManage }: AgentPick) {
  const t = useUiText();
  const agents = useAgents();
  return (
    <label
      className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink"
      title={`Agent: ${agentOf(value, agents).tagline}`}
    >
      <span className="sr-only">{t("Agent")}</span>
      <select value={value} onChange={(e) => (e.target.value === MANAGE ? onManage?.() : onPick(e.target.value))} className={BARE_SELECT}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {agentLabel(a)}
          </option>
        ))}
        {onManage && <option value={MANAGE}>{t("Manage agents…")}</option>}
      </select>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-1.5" />
    </label>
  );
}

"use client";

// The New thread dialog's model picker and the controls below the composer.

import { useUiText } from "@/lib/ui-language";
import type { ReactNode } from "react";
import type { Backend, Effort, PermissionMode } from "@/lib/types";
import { EFFORTS } from "@/lib/new-thread";
import { agentLabel, agentOf, type ThreadAgent } from "@/lib/agents";
import { useAgents } from "@/lib/use-agents";
import ModelSelect from "./ModelSelect";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import RepoPicker from "./RepoPicker";
import IsolateMenu, { type IsolatePick } from "./IsolateMenu";
import WherePicker from "./WherePicker";
import type { NewCardDialogLogic } from "@/lib/use-new-card-dialog";
import type { NewCardTransport } from "@/lib/new-card-transport";
import { suggestIsolate } from "@/lib/use-isolate";

// A select inside a bordered label that draws the box and chevron itself.
const BARE_SELECT = "cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none";
// The model as the phone shows it over the input: a rounded pill with a ✨.
const MODEL_PILL = "flex max-w-56 items-center gap-1 rounded-full border border-line-strong py-1 pl-2.5 pr-2 text-[12px] text-ink";

export function NewThreadModelPicker({ cwd, backend, model, onPickModel, onPickCli, pill = false }: {
  // Left out where its models aren't read from this machine (weft.zip).
  cwd?: string;
  backend: Backend;
  model: string;
  onPickModel: (model: string) => void;
  onPickCli: (backend: Backend) => void;
  // A rounded pill over the composer, in simple mode's one-box dialog (components/NewCardOneBox.tsx).
  pill?: boolean;
}) {
  const t = useUiText();
  return (
    <label data-human-only className={pill ? MODEL_PILL : "flex max-w-56 items-center rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink"}>
      {pill && <span aria-hidden>✨</span>}
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
  where,
  yolo = true,
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
  // The place picker where folders aren't on this machine's disk (components/WherePicker.tsx), in the folder's spot.
  where?: ReactNode;
  // Skip permissions on offer; never from a browser (NEW_CARD_MODES).
  yolo?: boolean;
}) {
  const t = useUiText();
  // The folder, agent and mode decide what the thread may touch: a thread driving the board (board_view) can't set them.
  return (
    <div data-human-only className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
      {where ?? <RepoPicker value={cwd} home={home} onChange={onChooseFolder} />}
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
        yolo={yolo}
        up
      />
    </div>
  );
}

// The controls below the composer, wired to the dialog's state and its transport (the desktop's own server, or weft.zip's
// places). Left out while simple mode's one-box dialog shows its pills instead (shown false).
export function DialogControls({ shown, dialog, host, home, busyHere, onManageAgents }: {
  shown: boolean;
  dialog: NewCardDialogLogic;
  host: NewCardTransport;
  home: string;
  // How many busy cards share this folder (lib/overlap.ts), for the Isolate suggestion.
  busyHere: number;
  onManageAgents?: () => void;
}) {
  if (!shown) return null;
  return (
    <NewCardDialogControls
      cwd={dialog.cwd}
      home={home}
      backend={dialog.backend}
      effort={dialog.effort}
      permissionMode={dialog.permissionMode}
      onChooseFolder={dialog.chooseFolder}
      onPickEffort={dialog.setEffort}
      onPickMode={dialog.pickMode}
      isolate={{
        on: dialog.isolated,
        suggest: suggestIsolate(busyHere, dialog.promptLength),
        branch: dialog.branch,
        onSet: dialog.setIsolated,
        onBranch: dialog.pickBranch,
        branches: host.local,
      }}
      agent={host.local ? { value: dialog.agent, onPick: dialog.setAgent, onManage: onManageAgents } : undefined}
      yolo={host.local}
      where={host.places && <WherePicker places={host.places} value={dialog.cwd} onChange={dialog.chooseFolder} plan={host.plan} />}
    />
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

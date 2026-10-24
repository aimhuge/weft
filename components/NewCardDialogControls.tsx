"use client";

// The New thread dialog's controls row: folder picker, model picker, effort picker, and the permission
// mode picker. Extracted from NewCardDialog.tsx so the dialog body and the controls can change on
// their own schedule.

import type { Backend, Effort, PermissionMode } from "@/lib/types";
import { EFFORTS, NO_MODEL } from "@/lib/new-thread";
import ModelSelect from "./ModelSelect";
import Icon from "./Icon";
import ModePicker from "./ModePicker";
import RepoPicker from "./RepoPicker";
import IsolateToggle from "./IsolateToggle";

export function NewCardDialogControls({
  cwd,
  home,
  backend,
  model,
  effort,
  permissionMode,
  onChooseFolder,
  onPickModel,
  onPickEffort,
  onPickMode,
  isolate,
}: {
  cwd: string;
  home: string;
  backend: Backend;
  model: string;
  effort: Effort | "";
  permissionMode: PermissionMode;
  onChooseFolder: (folder: string) => void;
  onPickModel: (model: string) => void;
  onPickEffort: (effort: Effort | "") => void;
  onPickMode: (mode: PermissionMode) => void;
  // The Isolated switch (components/IsolateToggle.tsx); left out where isolation isn't offered.
  isolate?: { on: boolean; suggest: boolean; onToggle: () => void };
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-3">
      <RepoPicker value={cwd} home={home} onChange={onChooseFolder} />
      {isolate && <IsolateToggle {...isolate} />}

      <label className="relative flex items-center gap-1.5 rounded-md border border-line-strong py-1.5 pl-2.5 pr-1.5 text-[12px] text-ink">
        <span className="sr-only">Model</span>
        <ModelSelect
          value={model}
          label="Model"
          leading={[{ value: NO_MODEL, label: "Default model" }]}
          onChange={onPickModel}
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
            className="cursor-pointer appearance-none bg-transparent pr-4 font-medium outline-none"
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
      />
    </div>
  );
}

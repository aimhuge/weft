"use client";

// The chips above weft.zip's phone-width input bar (components/web-board/PhoneNewCard.tsx): the New thread dialog's
// pickers in the desktop's own order (NEW_CARD_FIELDS), each a chip over a native select, so a phone opens its own
// picker. Where it runs, Shared or a worktree, the model (which picks the CLI), the effort and the mode, with Plan first
// before it on a worker. The Agent stays the project's default from a browser (lib/new-card-transport.ts), and tags
// come from the prompt, as on the desktop.
import type { ReactNode } from "react";
import { useUiText } from "@/lib/ui-language";
import { EFFORTS } from "@/lib/new-thread";
import { canBacklog, isWorkerDevice, placeKey, useNewCardTransport } from "@/lib/new-card-transport";
import { permissionOptions, type Effort, type PermissionMode } from "@/lib/types";
import type { NewCardDialogLogic } from "@/lib/use-new-card-dialog";
import type { WebTarget } from "@/lib/web-commands";
import ModelSelect from "../ModelSelect";

const CHIP = "relative flex flex-none items-center rounded-full border border-line-strong bg-panel px-3 py-1.5 text-[12.5px] text-ink";
const SELECT = "max-w-40 cursor-pointer appearance-none truncate bg-transparent font-medium outline-none";

function Chip({ label, children, on = false }: { label: string; children: ReactNode; on?: boolean }) {
  return (
    <label className={`${CHIP} ${on ? "border-accent/60 text-accent" : ""}`}>
      <span className="sr-only">{label}</span>
      {children}
    </label>
  );
}

export function PhoneChips({ dialog, places }: { dialog: NewCardDialogLogic; places: WebTarget[] }) {
  const t = useUiText();
  const { plan } = useNewCardTransport();
  // Plan first is a worker's own mode (lib/new-card-transport.ts), shown as a chip of its own there.
  const planChip = plan && !canBacklog(dialog.cwd);
  const modes = permissionOptions(dialog.backend).filter((m) => m.id !== "bypassPermissions");
  const option = (p: WebTarget) => (
    <option key={placeKey(p)} value={placeKey(p)}>
      {isWorkerDevice(p.device) ? "☁️" : "💻"} {p.label}
    </option>
  );
  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 py-2" role="group" aria-label={t("New thread options")}>
      <Chip label={t("Where it runs")}>
        <select value={dialog.cwd} onChange={(e) => dialog.chooseFolder(e.target.value)} className={SELECT}>
          {places.map(option)}
        </select>
      </Chip>
      <Chip label={t("Isolation")} on={dialog.isolated}>
        <select value={dialog.isolated ? "worktree" : "shared"} onChange={(e) => dialog.setIsolated(e.target.value === "worktree")} className={SELECT}>
          <option value="shared">{t("Shared")}</option>
          <option value="worktree">{t("Worktree")}</option>
        </select>
      </Chip>
      <Chip label={t("Model")}>
        <ModelSelect value={dialog.model} label={t("Model")} onChange={dialog.setModel} cli={{ backend: dialog.backend, onPick: dialog.pickCliDefault }} className={SELECT} />
      </Chip>
      {dialog.backend !== "puku" && (
        <Chip label={t("Effort")}>
          <select value={dialog.effort} onChange={(e) => dialog.setEffort(e.target.value as Effort | "")} className={SELECT}>
            {EFFORTS.map((e) => (
              <option key={e.id} value={e.id}>
                {t(e.label)}
              </option>
            ))}
          </select>
        </Chip>
      )}
      {planChip && (
        <label className={`${CHIP} gap-1.5 ${plan.on ? "border-accent/60 text-accent" : ""}`}>
          <input type="checkbox" checked={plan.on} onChange={(e) => plan.set(e.target.checked)} />
          {t("Plan first")}
        </label>
      )}
      <Chip label={t("Mode")}>
        <select value={dialog.permissionMode} onChange={(e) => dialog.pickMode(e.target.value as PermissionMode)} className={SELECT}>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
      </Chip>
    </div>
  );
}

"use client";

import { api } from "@/lib/client";
import { useUiText } from "@/lib/ui-language";
import type { SubagentModel } from "@/lib/subagents";
import { ModelPicker } from "./Pickers";
import { useSavedPick } from "./ModelSelect";

// Settings' "Use … for subagents" row. It saves as soon as it changes; new and idle threads
// pick it up on their next message (lib/runner-session.ts).
export default function SubagentPicker({ value }: { value: SubagentModel }) {
  const t = useUiText();
  const leading = [
    { value: "choose", label: t("Let the model choose") },
    { value: "inherit", label: t("Same model as the thread") },
  ];
  const [model, pick, error] = useSavedPick(value, (next) => api.saveSettings({ subagentModel: next }));
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink" data-settings-section="Use for subagents">{t("Use for subagents")}</h3>
        <p className="text-[12.5px] text-muted">
          {error ?? t("Letting the model choose picks per task. The other CLI's models run it headless as the subagent.")}
        </p>
      </div>
      <ModelPicker value={model} label={t("Use for subagents")} leading={leading} onChange={pick} />
    </section>
  );
}

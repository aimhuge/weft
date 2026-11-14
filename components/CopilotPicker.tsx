"use client";

import { useState } from "react";
import { useUiText } from "@/lib/ui-language";
import { api } from "@/lib/client";
import { ModelPicker } from "./Pickers";

// Settings' "Copilot" row: which model the copilot thread starts on when the card is
// first made (lib/copilot.ts). The card is one long-lived record (id: "copilot", role: "copilot"),
// so changing the pick here takes effect on the next "New chat" — the current conversation
// keeps running on the model it already chose.
export default function CopilotPicker({ value }: { value: string }) {
  const t = useUiText();
  const leading = [{ value: "", label: t("Default model (last picked)") }];
  const [model, setModel] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function pick(next: string) {
    const before = model;
    setModel(next);
    setError(null);
    api.saveSettings({ copilotModel: next }).catch((err: unknown) => {
      setModel(before);
      setError(`${t("Couldn’t save:")} ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink" data-settings-section="Copilot">{t("Copilot")}</h3>
        <p className="text-[12.5px] text-muted">
          {error ?? t("The model the copilot thread runs on. Every model is offered here; picking one moves the copilot to the CLI that serves it. The default follows the model you last picked for new threads.")}
        </p>
      </div>
      <ModelPicker
        value={model}
        onChange={pick}
        label={t("Model for the copilot")}
        leading={leading}
      />
    </section>
  );
}

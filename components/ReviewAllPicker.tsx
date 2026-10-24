"use client";

import { api } from "@/lib/client";
import { useSavedPick } from "./ModelSelect";
import { ModelPicker } from "./Pickers";

const LEADING = [{ value: "", label: "Default model" }];

// Settings' "Review all" row: the model the Review column's "Review all" card (the commit
// walk-through, lib/pile-review.ts) starts on. "" leaves it to the CLI's default. Every model is
// offered; picking one moves that card to the CLI that serves it.
export default function ReviewAllPicker({ value }: { value: string }) {
  const [model, pick, error] = useSavedPick(value, (next) => api.saveSettings({ reviewAllModel: next }));
  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">Review all</h3>
        <p className="text-[12.5px] text-muted">
          {error ?? "The model the Review column’s “Review all” card runs on. Every model is offered here."}
        </p>
      </div>
      <ModelPicker value={model} onChange={pick} label="Model for Review all" leading={LEADING} />
    </section>
  );
}

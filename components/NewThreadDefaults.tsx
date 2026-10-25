"use client";

import { useState } from "react";
import { lastEffort, modelFor, NO_MODEL, resolveModel, setLastEffort, setModelFor } from "@/lib/new-thread";
import type { Backend, Effort } from "@/lib/types";
import { EffortPicker, ModelPicker } from "./Pickers";

// Settings → Models → New threads: the CLI, model and effort a new thread starts on. The CLI
// waits for Save (it's a server setting the API and copilot use too); the model and effort
// are the New thread dialog's own remembered picks, so they change right away, and picking
// something else in that dialog moves them again.
//
// One menu picks the CLI and the model, the same one the New thread dialog uses: each CLI's
// heading starts with its own default, and picking a model moves the CLI to the one serving it.
export default function NewThreadDefaults({
  backend,
  onBackend,
}: {
  backend: Backend;
  onBackend: (backend: Backend) => void;
}) {
  const [models, setModels] = useState<Record<Backend, string>>(() => ({
    claude: modelFor("claude"),
    puku: modelFor("puku"),
    codex: modelFor("codex"),
    goose: modelFor("goose"),
  }));
  const [effort, setEffort] = useState<Effort | "">(lastEffort);

  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">New threads</h3>
        <p className="text-[12.5px] text-muted">
          What a new thread starts on. The New thread dialog remembers what you pick there, too.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ModelPicker
          value={models[backend]}
          onChange={(next) => {
            setModelFor(backend, next);
            // A model from another CLI moves the row's CLI with it, so the two always agree.
            const resolved = resolveModel(next);
            if (resolved && resolved.backend !== backend) {
              onBackend(resolved.backend);
              setModelFor(resolved.backend, next);
            }
            setModels((m) => ({ ...m, [backend]: next, ...(resolved ? { [resolved.backend]: next } : {}) }));
          }}
          label="Default model"
          // A CLI's own default row: that CLI, and "" (the CLI's own choice) as its model.
          cli={{
            backend,
            onPick: (next) => {
              setModelFor(next, NO_MODEL);
              setModels((m) => ({ ...m, [next]: NO_MODEL }));
              if (next !== backend) onBackend(next);
            },
          }}
        />
        <EffortPicker
          value={effort}
          onChange={(next) => {
            setLastEffort(next);
            setEffort(next);
          }}
          label="Default effort"
        />
      </div>
    </section>
  );
}

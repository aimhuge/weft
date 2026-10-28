"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { gooseModelsFor } from "@/lib/goose-provider";
import { useGooseChoice, useNamedModels } from "@/lib/use-named-models";

// The names the user gave their Goose models, in Settings → Models → "Bring your own key".
//
// A model id is what a provider serves ("anthropic/claude-opus-4.1", "puku-ai-2.8", a local Ollama
// tag). A user reads a name. So each row is an id and the name to show for it, and every model
// menu in Weft then offers "Big Opus" instead of the raw id — with the id beside it, so the row is
// still honest about what will run.
//
// The list is saved as one setting (gooseNamedModels), so a name is there for the New thread
// dialog, the copilot and /weft:done alike.

const INPUT_CLASS =
  "w-full rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

/** One row being edited: the id that runs, and the name the user reads. */
interface Row {
  id: string;
  name: string;
}

export default function GooseNamedModels() {
  const saved = useNamedModels();
  const goose = useGooseChoice();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The rows on screen: what the user is editing, or what the server holds.
  const list = rows ?? saved.map((m) => ({ id: m.id, name: m.name }));

  // The models the chosen provider serves, offered as the id to name — the ones a user names are
  // usually the provider's own, and typing an id that isn't listed still works.
  const suggestions = goose.providerId ? gooseModelsFor(goose.providerId, goose.modelId) : [];

  function edit(next: Row[]) {
    setRows(next);
    setError(null);
  }

  function save(next: Row[]) {
    setRows(next);
    setBusy(true);
    setError(null);
    // The server drops the empty rows and the duplicates, so the list as typed is fine to send.
    api
      .saveSettings({
        gooseNamedModels: next
          .map((r) => ({ id: r.id.trim(), name: r.name.trim() }))
          .filter((r) => r.id && r.name),
      })
      .then(
        () => setBusy(false),
        (err: unknown) => {
          setBusy(false);
          setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
        },
      );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-[12.5px] font-medium text-ink">Model names</h4>
        <p className="text-[12.5px] text-muted">
          {error ??
            "Give your models a name and every model menu shows that name instead of the raw id."}
        </p>
      </div>

      {list.length === 0 && (
        <p className="text-[11.5px] text-faint">
          No models named yet. Add one below — for example “Big Opus” for anthropic/claude-opus-4.1.
        </p>
      )}

      {list.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={row.id}
            onChange={(e) => edit(list.map((r, j) => (j === i ? { ...r, id: e.target.value } : r)))}
            placeholder="Model id"
            aria-label={`Model id for ${row.name || "the new name"}`}
            spellCheck={false}
            list={i === list.length - 1 && suggestions.length ? "goose-model-ids" : undefined}
            className={INPUT_CLASS}
          />
          <input
            type="text"
            value={row.name}
            onChange={(e) => edit(list.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
            placeholder="Name"
            aria-label={`Name for ${row.id || "the new model"}`}
            spellCheck={false}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={() => save(list.filter((_, j) => j !== i))}
            disabled={busy}
            className="shrink-0 rounded-md border border-line-strong px-2 py-[6px] text-[11.5px] text-muted hover:text-ink disabled:opacity-40"
            aria-label={`Forget the name for ${row.id || row.name || "this model"}`}
          >
            Remove
          </button>
        </div>
      ))}

      {suggestions.length > 0 && (
        <datalist id="goose-model-ids">
          {suggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => edit([...list, { id: "", name: "" }])}
          disabled={busy}
          className="shrink-0 rounded-md border border-line-strong px-2.5 py-[6px] text-[11.5px] text-muted hover:text-ink disabled:opacity-40"
          aria-label="Name another model"
        >
          Name another model
        </button>
        {rows !== null && (
          <button
            type="button"
            onClick={() => save(list)}
            disabled={busy}
            className="shrink-0 rounded-md bg-accent px-2.5 py-[6px] text-[11.5px] font-medium text-on-accent disabled:opacity-40"
            aria-label="Save the model names"
          >
            Save names
          </button>
        )}
      </div>
    </section>
  );
}

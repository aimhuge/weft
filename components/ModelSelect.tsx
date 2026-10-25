"use client";

import { useState } from "react";
import { BACKENDS, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL, MODELS, NO_MODEL } from "@/lib/new-thread";
import { useLimitedModels } from "@/lib/use-plan-limits";
import { useGooseProviders } from "@/lib/use-goose";
import { setUpGooseModels } from "@/lib/goose-provider";
import type { Backend } from "@/lib/types";

// Every model menu in Weft: the New thread dialog's, and each one in Settings → Models. One
// optgroup per CLI, headed by the CLI's own name, so a model added to MODELS shows up under the
// right CLI without anyone touching this file. Every menu offers the whole list: no row is
// narrowed to one CLI, and picking a model moves that row's CLI to the one serving it.

export const SELECT_CLASS =
  "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export type PickerOption = { value: string; label: string };

// What each CLI needs before a thread on it can run, as its default's tooltip. The two plain
// CLIs need nothing said; the other two need something installed, or the thread fails on its
// first turn with a message the user never saw coming.
const CLI_HINTS: Record<Backend, string | undefined> = {
  claude: undefined,
  puku: undefined,
  codex: "Requires Codex CLI and login. Weft's browser, board, secrets and webhook tools are unavailable.",
  goose: "Requires the Goose CLI and a provider key (Settings → Models → Bring your own key).",
};

// "This CLI, its own default model", as an option value. No model id starts with it.
const CLI_DEFAULT = "cli:";
// The CLIs' own default sentinels: in a menu that also picks the CLI they show once, as that
// CLI's default row, rather than twice.
const DEFAULT_IDS = new Set([NO_MODEL, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL]);

// Whether a model belongs in the menu. A Goose model shows only when a saved provider key serves
// it (Settings → Models → Bring your own key); Goose's own default always does, and so does the
// row's current pick, so the menu never shows a value it doesn't list.
function useOffered(value: string) {
  const ready = setUpGooseModels(useGooseProviders().providers);
  return (backend: Backend, id: string) => backend !== "goose" || id === GOOSE_DEFAULT_MODEL || id === value || ready.has(id);
}

// A menu that picks the CLI too: the row's CLI, and the pick of a CLI with its own default model.
export type CliPick = { backend: Backend; onPick: (backend: Backend) => void };

export default function ModelSelect({
  value,
  label,
  leading = [],
  onChange,
  cli,
  className = SELECT_CLASS,
}: {
  value: string;
  label: string;
  leading?: PickerOption[];
  onChange: (value: string) => void;
  // Given, each CLI's heading starts with a "<CLI> default" row and the menu is the CLI picker.
  cli?: CliPick;
  // The select's own look; a caller that draws the box around it passes a bare one.
  className?: string;
}) {
  const atLimit = new Set(useLimitedModels().map((l) => l.model));
  const offered = useOffered(value);
  const shown = cli && DEFAULT_IDS.has(value) ? CLI_DEFAULT + cli.backend : value;
  function pick(next: string) {
    if (cli && next.startsWith(CLI_DEFAULT)) cli.onPick(next.slice(CLI_DEFAULT.length) as Backend);
    else onChange(next);
  }
  return (
    <select value={shown} aria-label={label} onChange={(e) => pick(e.target.value)} className={className}>
      {leading.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {BACKENDS.map((b) => (
        <optgroup key={b.id} label={b.label}>
          {cli && (
            <option value={CLI_DEFAULT + b.id} title={CLI_HINTS[b.id]}>
              {b.label} default
            </option>
          )}
          {MODELS[b.id]
            .filter((m) => (!cli || !DEFAULT_IDS.has(m.id)) && offered(b.id, m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {atLimit.has(m.id) ? `${m.label} — at its limit` : m.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

// A Settings value that saves as soon as it changes, and goes back with the reason if the save fails.
export function useSavedPick<T>(initial: T, save: (value: T) => Promise<unknown>) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  function pick(next: T) {
    const before = value;
    setValue(next);
    setError(null);
    save(next).catch((err: unknown) => {
      setValue(before);
      setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  return [value, pick, error] as const;
}

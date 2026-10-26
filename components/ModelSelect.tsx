"use client";

import { useMemo, useState } from "react";
import { CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL, MODELS, NO_MODEL } from "@/lib/new-thread";
import { useLimitedModels } from "@/lib/use-plan-limits";
import { useGooseProviders } from "@/lib/use-goose";
import { setUpGooseModels } from "@/lib/goose-provider";
import { useNamedModels } from "@/lib/use-named-models";
import { CLI_CHOICE, cliChoiceBackend, isCliChoice, modelGroups, type NamedModel } from "@/lib/model-options";
import type { Backend } from "@/lib/types";
import ModelTypeahead from "./ModelTypeahead";

// Every model menu in Weft: the New thread dialog's, and each one in Settings → Models. One
// group per CLI, headed by the CLI's own name, so a model added to MODELS shows up under the
// right CLI without anyone touching this file. Every menu offers the whole list: no row is
// narrowed to one CLI, and picking a model moves that row's CLI to the one serving it.
//
// The menu is a typeahead (components/ModelTypeahead.tsx), not a native select: a native menu
// can't be typed into and draws its own list wherever the OS feels like, which on a short window
// is off the bottom of the screen and under the browser pane.
//
// No row is called "default". A CLI's own choice reads as what it does ("Let Claude Code choose"),
// and the models below it are the models themselves.

export const SELECT_CLASS =
  "rounded-md border border-line-strong bg-canvas px-2.5 py-[7px] text-[12.5px] text-ink outline-none focus:border-accent";

export type PickerOption = { value: string; label: string };

// The CLIs' own default sentinels: in a menu that also picks the CLI they show once, as that
// CLI's default row, rather than twice.
const DEFAULT_IDS = new Set([NO_MODEL, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL]);

// Whether a model belongs in the menu. A Goose model shows only when a saved provider key serves
// it (Settings → Models → Bring your own key); the models the user named always do, and so does
// the row's current pick, so the menu never shows a value it doesn't list.
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
  // The models that have hit their own cap, as a set. The hook is called here and the set is
  // memoized from its result, so the groups below don't change on every render.
  const limited = useLimitedModels();
  const atLimit = useMemo(() => new Set(limited.map((l) => l.model)), [limited]);
  const offered = useOffered(value);
  const names = useNamedModels();

  // The models the user named, per CLI. A named model shows under the CLI that serves it.
  const named = useMemo(() => {
    const byBackend: Partial<Record<Backend, NamedModel[]>> = {};
    for (const model of names) {
      const backend = backendOf(model.id);
      if (!backend) continue;
      byBackend[backend] = [...(byBackend[backend] ?? []), model];
    }
    return byBackend;
  }, [names]);

  const groups = useMemo(
    () =>
      modelGroups({
        named,
        atLimit,
        offer: offered,
        withCliChoice: Boolean(cli),
      }),
    [named, atLimit, offered, cli],
  );

  // The value the menu holds: a "the CLI chooses" row, or a model id.
  const shown = cli && (DEFAULT_IDS.has(value) || value === NO_MODEL) ? CLI_CHOICE + cli.backend : value;

  function pick(next: string) {
    if (isCliChoice(next)) {
      const backend = cliChoiceBackend(next);
      if (cli && backend) cli.onPick(backend);
      return;
    }
    onChange(next);
  }

  // The leading options (e.g. "Card's own model") ride at the top of the list, above the CLIs.
  const leadingRows = leading.map((o) => ({
    value: o.value,
    label: o.label,
    backend: "" as unknown as Backend,
  }));

  const allGroups = leadingRows.length
    ? [{ backend: "leading" as unknown as Backend, heading: "", rows: leadingRows }, ...groups]
    : groups;

  return (
    <ModelTypeahead
      value={shown}
      groups={allGroups}
      onChange={pick}
      label={label}
      className={className}
    />
  );
}

// The CLI a model id belongs to: the one whose list names it, or "goose" for a Goose model the
// user named (a Goose provider serves ids no list can know).
function backendOf(id: string): Backend | undefined {
  const known = (Object.keys(MODELS) as Backend[]).find((b) => MODELS[b].some((m) => m.id === id));
  if (known) return known;
  return undefined;
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

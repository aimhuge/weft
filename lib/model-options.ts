// The rows a model menu shows, and what each one is called.
//
// One rule runs through this file: a row a user reads must name the model that will actually run.
// "Let Claude Code choose", "Let Codex choose" and the rest all say the same thing — that the CLI
// will choose — and none of them tell the user which model that is. So every row is a model: the
// ones a CLI lists by name, and the one row each CLI keeps for the model living in its own config.
//
// The Goose rows come from the provider the user configured: a model id is whatever that provider
// serves, and a named model is one the user gave a name to (lib/goose-models.ts).

import { BACKENDS, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL, MODELS, backendFor, bareModel, gooseValue } from "./new-thread";
import type { Backend } from "./types";

// A row in a model menu.
export interface ModelOption {
  // The value the menu hands back: the model id to run.
  value: string;
  // What the user reads.
  label: string;
  // The model id, when it differs from the label — a named model's id shows beside its name.
  id?: string;
  // The CLI that serves it; the menu groups the rows by it.
  backend: Backend;
  // A note under the row: the CLI's own choice, a model at its limit, a model with no key.
  note?: string;
}

// The CLIs whose model lives in their own config: Codex reads its model from its own config,
// Goose from the provider the user set up. Each has one row in the menu for it, and picking that
// row moves a thread to that CLI with no model pinned.
const CLI_DEFAULT_IDS: ReadonlySet<string> = new Set([CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL]);

/** Whether a string names one of the CLIs Weft knows. */
export function isBackend(value: string): value is Backend {
  return BACKENDS.some((b) => b.id === value);
}

/**
 * The model a CLI runs when no model is pinned: the first model of the CLI's own list. This is
 * what a thread with no model picked shows, so the user reads the model that will actually run.
 * Empty for a CLI whose model lives in its own config (Codex, Goose) — those have their own row.
 */
export function cliChoiceModel(backend: Backend): string {
  if (backend === "goose") return "";
  return MODELS[backend].find((m) => !CLI_DEFAULT_IDS.has(m.id))?.id ?? "";
}

// A model the user named: a name to read and the id to run.
export interface NamedModel {
  id: string;
  name: string;
}

/**
 * The value a Goose row hands back. One of Goose's own listed ids is Goose's alone, so it stays as it
 * is (and matches what Settings already saved); any other id ("puku-ai-2.8" through a Puku key, a
 * local model) gets the "goose:" prefix, so it can't be mistaken for another CLI's same id.
 */
export function gooseRowValue(id: string): string {
  return backendFor(id) === "goose" ? id : gooseValue(id);
}

/**
 * The Goose models a menu lists first: the ones the user named (Settings → Models → Bring your own
 * key), then the model Goose is configured to run, when it has no name — it shows by its id, so the
 * user can always pick the model their key serves.
 */
export function gooseNamed(named: NamedModel[], configured = ""): NamedModel[] {
  const id = configured.trim();
  if (!id || id === GOOSE_DEFAULT_MODEL || named.some((m) => m.id === id)) return named;
  const listed = MODELS.goose.find((m) => m.id === id)?.label;
  return [...named, { id, name: listed ?? id }];
}

/**
 * The rows for one CLI: the models it serves.
 *
 * `named` are the models the user gave a name to (a Goose provider's models, and any model saved
 * under a name); they come first in the CLI's group, because a name the user chose is the one the
 * user is looking for.
 */
export function optionsFor(
  backend: Backend,
  options: { named?: NamedModel[]; atLimit?: Set<string>; offer?: (backend: Backend, id: string) => boolean } = {},
): ModelOption[] {
  const { named = [], atLimit = new Set<string>(), offer } = options;
  const rows: ModelOption[] = [];

  for (const model of named) {
    rows.push({
      value: backend === "goose" ? gooseRowValue(model.id) : model.id,
      label: model.name,
      id: model.name === model.id ? undefined : model.id,
      backend,
      note: atLimit.has(model.id) ? "At its limit" : undefined,
    });
  }

  for (const model of listedModels(backend, { named, offer })) {
    rows.push({
      value: model.id,
      label: model.label,
      backend,
      note: atLimit.has(model.id) ? "At its limit" : undefined,
    });
  }

  return rows;
}

// The CLI's own models a menu lists under it, leaving out the ones another row already stands for.
function listedModels(
  backend: Backend,
  { named, offer }: { named: NamedModel[]; offer?: (backend: Backend, id: string) => boolean },
) {
  return MODELS[backend].filter(
    (model) =>
      // A model the user already named shows once, under its name.
      !named.some((n) => n.id === model.id) &&
      (!offer || offer(backend, model.id)),
  );
}

/**
 * Every row in the menu, grouped by the CLI that serves it.
 *
 * The groups come back in the CLIs' own order, each with its heading, so a model added to a
 * CLI's list shows up under the right CLI without anyone touching this file.
 */
export function modelGroups(
  options: {
    named?: Partial<Record<Backend, NamedModel[]>>;
    atLimit?: Set<string>;
    offer?: (backend: Backend, id: string) => boolean;
  } = {},
): { backend: Backend; heading: string; rows: ModelOption[] }[] {
  const { named = {}, atLimit = new Set<string>(), offer } = options;
  return BACKENDS.map((b) => ({
    backend: b.id,
    heading: b.label,
    rows: optionsFor(b.id, { named: named[b.id], atLimit, offer }),
  })).filter((g) => g.rows.length > 0);
}

/**
 * The label a picked value shows in the field. A named model shows its name; a plain model shows
 * its label.
 *
 * A value with no row — an empty pick — falls back to the model the CLI runs, so the field never
 * says "let the CLI choose": every row in a menu is a model, and so is what an empty one shows.
 */
export function labelFor(value: string, groups: { backend: string; rows: ModelOption[] }[]): string {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.value === value) return row.label;
    }
  }
  if (!value) {
    const backend = groups[0]?.backend ?? "claude";
    if (isBackend(backend)) {
      const model = cliChoiceModel(backend);
      const label = MODELS[backend].find((m) => m.id === model)?.label;
      if (label) return label;
    }
  }
  return value;
}

/**
 * The rows a search keeps, and the group headings that survive. A row matches when the label, the
 * model id or the CLI's name contains the query — so "opus" finds an Opus on any CLI, and "goose"
 * finds every Goose model.
 *
 * The id is matched even when the row doesn't show it: "opus-4.8" is how the id is written in a
 * card's header and in a command line, and typing it should find the model. A Goose row's value
 * carries the "goose:" prefix, so the bare id is matched too.
 */
export function filterGroups<T extends { heading: string; rows: ModelOption[] }>(
  groups: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => {
        // The value carries the "goose:" prefix on a Goose row; the bare id is what the user
        // knows, so both are searched.
        const bare = bareModel(row.value);
        return `${row.label} ${row.id ?? ""} ${row.value} ${bare} ${group.heading}`.toLowerCase().includes(q);
      }),
    }))
    .filter((group) => group.rows.length > 0);
}

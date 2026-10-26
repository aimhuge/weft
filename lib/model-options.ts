// The rows a model menu shows, and what each one is called.
//
// One rule runs through this file: a row a user reads must name the model that will actually run.
// "Claude Code default", "puku-cli default", "Codex default" and "Goose default" all say the same
// thing — that the CLI will choose — and none of them tell the user which model that is. So the
// menu's rows are the models themselves, and the "the CLI picks" row is named for what it does.
//
// The Goose rows come from the provider the user configured: a model id is whatever that provider
// serves, and a named model is one the user gave a name to (lib/goose-models.ts).

import { BACKENDS, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL, MODELS, NO_MODEL } from "./new-thread";
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

// The row that means "let the CLI choose". It is not a model, so it carries no model id; picking it
// leaves the model off the CLI's command line.
export const CLI_CHOICE = "cli:";

// The CLIs' own "you choose" ids in MODELS ("codex-default", "goose-default"). They mean the same as the
// "the CLI chooses" row, so a menu that has that row leaves them out, and none of them is a model to name.
const CLI_DEFAULT_IDS: ReadonlySet<string> = new Set([NO_MODEL, CODEX_DEFAULT_MODEL, GOOSE_DEFAULT_MODEL]);

// What the "the CLI chooses" row says, per CLI. It names the CLI's own pick, which is what the
// user gets when they take this row — the honest version of "Claude Code default".
export function cliChoiceLabel(backend: Backend): string {
  switch (backend) {
    case "claude":
      return "Let Claude Code choose";
    case "puku":
      return "Let puku-cli choose";
    case "codex":
      return "Let Codex choose";
    case "goose":
      return "Let Goose choose";
  }
}

/** Whether a string names one of the CLIs Weft knows. */
export function isBackend(value: string): value is Backend {
  return BACKENDS.some((b) => b.id === value);
}

/** Whether a value is the "the CLI chooses" row. */
export function isCliChoice(value: string): boolean {
  return value.startsWith(CLI_CHOICE);
}

/** The CLI a "the CLI chooses" row names. */
export function cliChoiceBackend(value: string): Backend | undefined {
  if (!isCliChoice(value)) return undefined;
  const id = value.slice(CLI_CHOICE.length) as Backend;
  return BACKENDS.some((b) => b.id === id) ? id : undefined;
}

/**
 * The model a CLI's own choice actually runs, when we know it: the first model of the CLI's own
 * list. This is what the row's note says, so a user who takes "Let Goose choose" can see which
 * model that is. Empty when the CLI's choice isn't a model we can name.
 */
export function cliChoiceModel(backend: Backend): string {
  if (backend === "goose") return "";
  return MODELS[backend].find((m) => !CLI_DEFAULT_IDS.has(m.id))?.id ?? "";
}

/** The label a CLI's own choice names, when we know the model behind it. */
export function cliChoiceNote(backend: Backend): string | undefined {
  const model = cliChoiceModel(backend);
  if (!model) return undefined;
  const label = MODELS[backend].find((m) => m.id === model)?.label;
  return label ? `Runs ${label}` : undefined;
}

// A model the user named: a name to read and the id to run.
export interface NamedModel {
  id: string;
  name: string;
}

/**
 * The rows for one CLI: the models it serves, plus the "the CLI chooses" row when the menu picks
 * the CLI too.
 *
 * `named` are the models the user gave a name to (a Goose provider's models, and any model saved
 * under a name); they come first in the CLI's group, because a name the user chose is the one the
 * user is looking for.
 */
export function optionsFor(
  backend: Backend,
  options: { named?: NamedModel[]; atLimit?: Set<string>; offer?: (backend: Backend, id: string) => boolean; withCliChoice?: boolean } = {},
): ModelOption[] {
  const { named = [], atLimit = new Set<string>(), offer, withCliChoice = false } = options;
  const rows: ModelOption[] = [];

  if (withCliChoice) {
    rows.push({
      value: CLI_CHOICE + backend,
      label: cliChoiceLabel(backend),
      backend,
      note: cliChoiceNote(backend),
    });
  }

  for (const model of named) {
    rows.push({
      value: model.id,
      label: model.name,
      id: model.name === model.id ? undefined : model.id,
      backend,
      note: atLimit.has(model.id) ? "At its limit" : undefined,
    });
  }

  for (const model of listedModels(backend, { named, offer, withCliChoice })) {
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
  { named, offer, withCliChoice }: { named: NamedModel[]; offer?: (backend: Backend, id: string) => boolean; withCliChoice: boolean },
) {
  return MODELS[backend].filter(
    (model) =>
      // A model the user already named shows once, under its name.
      !named.some((n) => n.id === model.id) &&
      // The CLI's own sentinel would be a second "Let Codex choose" row that picks a model, not the CLI.
      !(withCliChoice && CLI_DEFAULT_IDS.has(model.id)) &&
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
    withCliChoice?: boolean;
  } = {},
): { backend: Backend; heading: string; rows: ModelOption[] }[] {
  const { named = {}, atLimit = new Set<string>(), offer, withCliChoice = false } = options;
  return BACKENDS.map((b) => ({
    backend: b.id,
    heading: b.label,
    rows: optionsFor(b.id, { named: named[b.id], atLimit, offer, withCliChoice }),
  })).filter((g) => g.rows.length > 0);
}

/**
 * The label a picked value shows in the field. A named model shows its name; a plain model shows
 * its label; the CLI's own choice shows what the CLI would run, or the CLI's name when we don't
 * know the model.
 */
export function labelFor(value: string, groups: { backend: string; rows: ModelOption[] }[]): string {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.value === value) return row.label;
    }
  }
  if (value === NO_MODEL) {
    const backend = groups[0]?.backend ?? "claude";
    return cliChoiceLabel(isBackend(backend) ? backend : "claude");
  }
  return value;
}

/**
 * The rows a search keeps, and the group headings that survive. A row matches when the label, the
 * model id or the CLI's name contains the query — so "opus" finds an Opus on any CLI, and "goose"
 * finds every Goose model.
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
      rows: group.rows.filter((row) => `${row.label} ${row.id ?? ""} ${group.heading}`.toLowerCase().includes(q)),
    }))
    .filter((group) => group.rows.length > 0);
}

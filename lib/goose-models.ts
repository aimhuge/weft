// The models the user named, so a model menu can show a name instead of a raw id.
//
// A model id is what a provider serves: "anthropic/claude-opus-4.1", "puku-ai-2.8", "gpt-4.1". A
// user reads a name. So Settings → Models lets the user give a model a name ("Big Opus", "Puku AI
// 2.8") and every model menu shows that name, with the id beside it.
//
// The names are a board setting (lib/settings.ts), so they travel with the project: a new thread,
// the copilot and /weft:done all show the same names.

import { readSetting, writeSetting } from "./settings-store";

// One named model: the id that runs, and the name the user reads.
export interface GooseNamedModel {
  id: string;
  name: string;
}

const NAMED = "gooseNamedModels";

/**
 * Whether a value is a list of named models: a list of pairs, each with a non-empty id and name.
 * A malformed entry is dropped rather than refusing the whole list, so one bad hand-edit doesn't
 * cost the user every name they set.
 */
function isNamedList(value: unknown): value is GooseNamedModel[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as { id?: unknown }).id === "string" &&
      typeof (m as { name?: unknown }).name === "string",
  );
}

/** The named models, in the order the user set them, with the empty ones dropped. */
export function namedModels(): GooseNamedModel[] {
  const stored = readSetting(NAMED, isNamedList, []);
  const seen = new Set<string>();
  return stored.filter((m) => {
    const id = m.id.trim();
    const name = m.name.trim();
    if (!id || !name || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((m) => ({ id: m.id.trim(), name: m.name.trim() }));
}

/** Saves the named models, dropping the empty ones and keeping the first of each id. */
export function setNamedModels(models: GooseNamedModel[]) {
  const seen = new Set<string>();
  const clean = models
    .map((m) => ({ id: m.id.trim(), name: m.name.trim() }))
    .filter((m) => {
      if (!m.id || !m.name || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  // An empty list is the default (nothing named), so it's stored as unset.
  writeSetting(NAMED, clean, (v) => Array.isArray(v) && v.length === 0);
}

/** Adds a named model, or renames the one already saved under that id. */
export function addNamedModel(id: string, name: string): GooseNamedModel[] {
  const cleanId = id.trim();
  const cleanName = name.trim();
  if (!cleanId || !cleanName) return namedModels();
  const next = namedModels().filter((m) => m.id !== cleanId);
  next.push({ id: cleanId, name: cleanName });
  setNamedModels(next);
  return next;
}

/** Forgets a named model. The model itself isn't removed from the CLI — only its name. */
export function removeNamedModel(id: string): GooseNamedModel[] {
  const next = namedModels().filter((m) => m.id !== id.trim());
  setNamedModels(next);
  return next;
}

/** The name a model is saved under, or undefined when it has none. */
export function nameFor(id: string): string | undefined {
  return namedModels().find((m) => m.id === id)?.name;
}

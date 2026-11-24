import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";

// The models this Antigravity account may use, as agy last said.
//
// agy's ACP `session/new` and `session/load` answer with `models.availableModels` ([{ modelId, name }]): the account's own
// list, which depends on its tier (a free account had Gemini 3.8 Flash plus Claude Sonnet 4.6, Claude Opus 4.6 and GPT-OSS
// 120B). lib/antigravity-runner.ts hands each answer to rememberAgyModels, which keeps it in ~/.weft/antigravity-models.json,
// and the model menus offer it in the Antigravity group (lib/model-options.ts antigravityList) through /api/settings.
//
// A file of its own, not a key in settings.json: it is what agy said, not something the user set, and it is rewritten
// whenever the account's list changes, so it stays out of the file every setting shares.

export interface AgyModel {
  id: string;
  label: string;
}

export const AGY_MODELS_FILE = path.join(DATA_DIR, "antigravity-models.json");

const cache = () => globalSingleton<{ models: AgyModel[] | null }>("__weftAgyModels", () => ({ models: null }));

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The account's models from agy's `models` answer, or null when it isn't one: a list of { modelId, name }, each id once. */
export function parseAgyModels(models: unknown): AgyModel[] | null {
  const list = (models as { availableModels?: unknown } | null | undefined)?.availableModels;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: AgyModel[] = [];
  for (const entry of list as unknown[]) {
    const id = text((entry as { modelId?: unknown } | null)?.modelId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: text((entry as { name?: unknown }).name) || id });
  }
  return out.length ? out : null;
}

function isAgyList(value: unknown): value is AgyModel[] {
  return Array.isArray(value) && value.every((m) => typeof (m as AgyModel | null)?.id === "string" && typeof (m as AgyModel).label === "string");
}

/** The models agy last offered this account, oldest answer kept until a new one comes; empty before the first. */
export function agyModels(): AgyModel[] {
  const c = cache();
  if (c.models) return c.models;
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(AGY_MODELS_FILE, "utf8"));
    c.models = isAgyList(saved) ? saved : [];
  } catch {
    c.models = [];
  }
  return c.models;
}

/** Keeps what agy's `session/new` or `session/load` said this account can use. Anything else, and the old list stays. */
export function rememberAgyModels(models: unknown): void {
  const parsed = parseAgyModels(models);
  if (!parsed) return;
  if (JSON.stringify(parsed) === JSON.stringify(agyModels())) return;
  cache().models = parsed;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AGY_MODELS_FILE, JSON.stringify(parsed, null, 2));
  } catch (err) {
    // A failed write costs the next launch the list, not this thread: the menus still read the copy in memory.
    console.warn("couldn't save Antigravity's models", err);
  }
}

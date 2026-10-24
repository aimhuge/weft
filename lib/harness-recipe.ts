// The Goose recipe as data: parsing it back and writing it out again (docs/architecture/goose.md).
//
// A composed harness is only useful if it can be turned into a recipe Goose will run, so the optimizer
// needs to read a recipe as well as write one. Goose's recipe format is YAML, but the recipe Weft writes
// has a fixed shape (lib/goose-recipe.ts's gooseRecipeYaml): a few scalar keys, a `settings` block and an
// empty `parameters` list. So this parses exactly that shape rather than pulling in a YAML library for a
// file format with a dozen lines — and a parse of a file that isn't that shape fails loudly, which is
// what a recipe the optimizer didn't write should do.
//
// The round trip is the point: parse(recipe) then write() gives back a recipe with the same enforced
// fields, so a harness that survived validation is the harness that gets run.
//
// Pure: no fs, no env, no globals.

import { yamlString, type GooseTurnPlan } from "./goose-recipe";
import type { Harness } from "./harness-policy";

/** A recipe, as the fields Weft enforces. */
export interface ParsedRecipe {
  title: string;
  description: string;
  prompt: string;
  instructions: string;
  provider: string;
  model: string;
  maxTurns: number;
}

/** The top level's text keys, and the field each one lands in. */
const TEXT_KEYS = {
  title: "title",
  description: "description",
  prompt: "prompt",
  instructions: "instructions",
} as const satisfies Record<string, "title" | "description" | "prompt" | "instructions">;

type TextKey = keyof typeof TEXT_KEYS;

/**
 * The field a text key lands in, or undefined for a key that isn't a text key.
 *
 * The map is the single list of text keys, so the reader and the set can't disagree about which key
 * goes where, and a key the map doesn't have is a key the recipe doesn't have.
 */
function textField(key: string): (typeof TEXT_KEYS)[TextKey] | undefined {
  return (TEXT_KEYS as Record<string, (typeof TEXT_KEYS)[TextKey] | undefined>)[key];
}

/**
 * The keys a recipe may carry at the top level. Anything else means it isn't one of ours.
 *
 * The text keys come from the map above and the two block keys are spelled out, so the set and the
 * reader can never disagree about which key goes where.
 */
const TOP_KEYS = new Set<string>([...Object.keys(TEXT_KEYS), "settings", "parameters"]);

/** The keys a recipe's settings block may carry. */
const SETTINGS_KEYS = new Set(["goose_provider", "goose_model", "max_turns"]);

/** A YAML scalar as Weft writes it: JSON-quoted, so it is one line and never ambiguous. */
function unquote(value: string): string | null {
  const text = value.trim();
  // A quoted value is JSON's own string syntax, so JSON.parse reads back exactly what was written.
  if (!text.startsWith('"')) return null;
  try {
    return JSON.parse(text) as string;
  } catch {
    return null;
  }
}

/**
 * One line of a recipe, split into its key and its value.
 *
 * A line with no colon is not a recipe line, so the parse refuses it rather than guessing.
 */
function splitLine(line: string): { key: string; value: string } | null {
  const split = line.indexOf(":");
  if (split < 0) return null;
  return { key: line.slice(0, split).trim(), value: line.slice(split + 1).trim() };
}

/**
 * One line of the settings block, read into the recipe.
 *
 * The block carries the provider, the model and the turn ceiling, and nothing else: a key outside
 * that list means the text is not a recipe Weft wrote, and the parse refuses it.
 */
function readSetting(recipe: ParsedRecipe, key: string, value: string): boolean {
  if (!SETTINGS_KEYS.has(key)) return false;
  if (key === "max_turns") {
    const turns = Number(value);
    if (!Number.isInteger(turns) || turns < 1) return false;
    recipe.maxTurns = turns;
    return true;
  }
  const text = unquote(value);
  if (text === null) return false;
  if (key === "goose_provider") recipe.provider = text;
  else recipe.model = text;
  return true;
}

/**
 * A recipe as data, or null when the text isn't a recipe Weft wrote.
 *
 * The parse is strict on purpose: an unknown key, an unquoted value or a missing `settings` block means
 * the text is not a recipe this code wrote, and the optimizer must not edit it.
 */
export function parseRecipe(text: string): ParsedRecipe | null {
  const recipe: ParsedRecipe = {
    title: "",
    description: "",
    prompt: "",
    instructions: "",
    provider: "",
    model: "",
    maxTurns: 0,
  };
  let inSettings = false;
  let sawSettings = false;
  let sawParameters = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const parts = splitLine(line);
    if (!parts) return null;
    const { key, value } = parts;

    if (/^\s/.test(line)) {
      if (!inSettings) return null;
      if (!readSetting(recipe, key, value)) return null;
      continue;
    }

    inSettings = false;
    const top = readTopLevel(recipe, key, value);
    if (!top) return null;
    if (top === "settings") sawSettings = true;
    if (top === "parameters") sawParameters = true;
    if (top === "settings") inSettings = true;
  }

  if (!sawSettings || !sawParameters) return null;
  return recipe;
}

/**
 * A top level key, read into the recipe. Returns the key's kind, or null when the text isn't a recipe.
 *
 * The two block keys open a block or close the parse; the rest are text keys, each read into its own
 * field. A key outside both lists means the text isn't a recipe Weft wrote, and the parse refuses it.
 */
function readTopLevel(recipe: ParsedRecipe, key: string, value: string): "settings" | "parameters" | "text" | null {
  if (!TOP_KEYS.has(key)) return null;
  if (key === "settings") return "settings";
  if (key === "parameters") {
    // The parameters block is a list, and Weft writes none, so only the empty list is ours.
    return value === "[]" ? "parameters" : null;
  }
  const text_value = unquote(value);
  if (text_value === null) return null;
  // The top level's text keys, each read into its own field. The two block keys are the only top level
  // keys that aren't text keys, so a key that got here has a field to land in.
  const field = textField(key);
  if (!field) return null;
  recipe[field] = text_value;
  return "text";
}

/**
 * A recipe as Goose's YAML, from a harness and the plan it runs under.
 *
 * The provider comes from the plan, never from the harness: the provider is policy, and the optimizer
 * has no business naming one. The harness's own model, max_turns, prompt and instructions do come from
 * the harness, because those are the surfaces it may edit.
 */
export function recipeYaml(harness: Harness, plan: GooseTurnPlan, title = "Weft thread"): string {
  const lines: string[] = [
    "title: " + yamlString(title),
    "description: " + yamlString("A Weft thread on the board."),
    "prompt: " + yamlString(harness.prompt),
  ];
  if (harness.instructions) lines.push("instructions: " + yamlString(harness.instructions));
  lines.push("settings:");
  const provider = (plan.provider ?? "").trim();
  if (provider) lines.push("  goose_provider: " + yamlString(provider));
  if (harness.model) lines.push("  goose_model: " + yamlString(harness.model));
  lines.push(`  max_turns: ${harness.maxTurns}`);
  lines.push("parameters: []");
  return `${lines.join("\n")}\n`;
}

/** A harness read back out of a recipe, so a round can start from what is on disk. */
export function harnessFromRecipe(recipe: ParsedRecipe): Harness {
  return {
    prompt: recipe.prompt,
    instructions: recipe.instructions,
    model: recipe.model,
    maxTurns: recipe.maxTurns,
    skills: [],
  };
}

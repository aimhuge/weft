// The turn's recipe, written to disk (docs/architecture/goose.md).
//
// A Goose recipe is the same plan the turn runs on, in Goose's own file format. Weft renders one for
// every turn (lib/goose-recipe.ts's gooseRecipeYaml) and writes it here, so a turn can be repeated by
// hand (`goose run --recipe turn.yaml`) or read to see exactly what the thread was told.
//
// Where it goes: under the card's own Goose state root — the same `GOOSE_PATH_ROOT` the turn runs
// with, one folder per card under ~/.weft. NOT the card's project folder: that is the user's working
// tree, and Weft does not litter it with files the user did not ask for.
//
// The name is `turn.yaml` and it is one file per card, overwritten each turn, on purpose. The recipe
// is what the card is running *now*: a stack of them would be a history, and the thing worth keeping
// is the current one. The recipe the optimizer adopts replaces this file (lib/harness-optimizer.ts),
// so the file on disk is always the harness in force.
//
// The write is atomic (a temp file then a rename), so a reader never sees half a recipe, and it
// never fails a turn: a recipe that can't be written is a recipe nobody can re-run by hand, which is
// a nuisance, not a reason to drop the user's work.

import fs from "node:fs";
import path from "node:path";
import { gooseStateRoot } from "./goose-state";

/** The folder the card's recipes live in, under the card's own Goose state root. */
export function recipeDir(cardId: string): string {
  return path.join(gooseStateRoot(cardId), "recipes");
}

/** The recipe file for a card: one per card, overwritten each turn. */
export function recipeFile(cardId: string): string {
  return path.join(recipeDir(cardId), "turn.yaml");
}

/**
 * Writes a card's recipe to disk.
 *
 * Returns whether it was written. A failure is reported, never thrown: the turn runs either way, and
 * the caller decides what to do with a missing file (nothing, or a warning on the card).
 */
export function writeRecipe(cardId: string, yaml: string): boolean {
  if (!cardId) return false;
  const file = recipeFile(cardId);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(recipeDir(cardId), { recursive: true });
    fs.writeFileSync(temp, yaml);
    fs.renameSync(temp, file);
    return true;
  } catch (err) {
    console.error(`Couldn't write the Goose recipe for ${cardId}.`, err);
    // The temp file is not the recipe, so a half-written one is not left behind.
    try {
      fs.rmSync(temp, { force: true });
    } catch {}
    return false;
  }
}

/**
 * A card's recipe, as it is on disk, or "" when there is none.
 *
 * This is the optimizer's way back in: it reads the harness the card is running under rather than
 * assuming one (lib/harness-recipe.ts's parseRecipe reads what this returns).
 */
export function readRecipe(cardId: string): string {
  try {
    return fs.readFileSync(recipeFile(cardId), "utf8");
  } catch {
    return "";
  }
}

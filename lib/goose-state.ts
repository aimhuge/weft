// Where Goose keeps its own state for a card (docs/architecture/goose.md).
//
// Goose's config, data and session rows live under `GOOSE_PATH_ROOT`, and Weft points that at
// ~/.weft/goose/<card id>, one folder per card, so two cards never share one Goose database.
// `--no-session` doesn't skip that: Goose still writes a hidden session row.
//
// This lives apart from lib/goose-runner.ts because the recipe store (lib/goose-recipe-store.ts) needs
// the same root and the runner imports that store: keeping the root here keeps the two from forming
// a circle.

import fs from "node:fs";
import path from "node:path";

/** The folder a card's Goose state lives in: under Weft's data dir, one per card. */
export function gooseStateRoot(cardId: string): string {
  // `||` and not `??`: an empty WEFT_DATA is no data dir, and falling back to the home folder is right.
  // With `??` an empty one would make the root relative ("goose/<card>"), and Goose's state would land
  // in whatever folder the server happened to be started in.
  const root = process.env.WEFT_DATA || path.join(process.env.HOME || "/tmp", ".weft");
  return path.join(root, "goose", cardId);
}

/**
 * Whether the card has a Goose session to resume. `goose run --resume` fails when there is none, and Goose
 * keeps a card's sessions in one database under its root, there from the card's first run on.
 */
export function gooseHasSession(cardId: string): boolean {
  return fs.existsSync(path.join(gooseStateRoot(cardId), "data", "sessions", "sessions.db"));
}

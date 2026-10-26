import { BACKEND_LABELS, type Backend } from "./types";

// Codex and Goose run without Weft's thread guards (docs/architecture/thread-guards.md): they have no per-tool hooks,
// so the secret guard, the folder gate and the Bash hooks (restart, git and check guards, symbol claims) never see
// their calls. Every place a CLI is picked says so, so nobody chooses one without knowing.
const UNGUARDED: ReadonlySet<Backend> = new Set<Backend>(["codex", "goose"]);

// The short tag that rides along on a CLI's name in a menu, where there is no room for a sentence.
export const UNGUARDED_TAG = "no Weft guards";

export function unguarded(backend: Backend): boolean {
  return UNGUARDED.has(backend);
}

// The one-line notice for a thread about to run on this CLI, or null when Weft's guards cover it.
export function unguardedNotice(backend: Backend): string | null {
  if (!unguarded(backend)) return null;
  return `${BACKEND_LABELS[backend]} runs without Weft's guards: no secret guard, folder gate or Bash hooks.`;
}

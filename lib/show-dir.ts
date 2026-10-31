import path from "node:path";
import { DATA_DIR } from "./store";

// Where threads write the pages they show in the pane (plans, commits, how-tos, answers). It sits in
// ~/.weft beside pages/ and library/ so it survives reboots: macOS clears /tmp, and pages lived there once.
export const SHOW_DIR = path.join(DATA_DIR, "show");

// A session's working directories beyond its folder: what the card was granted, and SHOW_DIR for every
// thread, since the system prompt tells each one to write its pages there. Without it the CLI's own
// working-directory gate asked the user before a thread could write its own page (2026-10-31).
export function sessionDirs(readScope: string[] | undefined): string[] {
  return [...new Set([...(readScope ?? []), SHOW_DIR])];
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./store";

// Where threads write the pages they show in the pane (plans, commits, how-tos, answers). It sits in
// ~/.weft beside pages/ and library/ so it survives reboots: macOS clears /tmp, and pages lived there once.
export const SHOW_DIR = path.join(DATA_DIR, "show");

// A session's working directories beyond its folder: what the card was granted, and SHOW_DIR for every
// thread, since the system prompt tells each one to write its pages there. Without it the CLI's own
// working-directory gate asked the user before a thread could write its own page (2026-10-31). The folder
// is made first: the CLI drops a directory that isn't there and asks again.
// The temp dirs ride along too: threads clone and build scratch copies in /tmp (and macOS's per-user tmpdir is
// /var/folders/…/T, not /tmp), and each command there used to ask, dozens a turn (2026-11-02).
export function sessionDirs(readScope: string[] | undefined): string[] {
  try {
    fs.mkdirSync(SHOW_DIR, { recursive: true });
  } catch {
    // An unwritable data dir: the thread asks, as before.
  }
  return [...new Set([...(readScope ?? []), ...scratchDirs()])];
}

// Folders every thread may read and write with no prompt, whatever its permission mode: its pane pages and the temp
// dirs, each as written and by its real path (/tmp is /private/tmp), so a command naming either form matches.
export function scratchDirs(): string[] {
  return [...new Set([SHOW_DIR, "/tmp", os.tmpdir()].flatMap((dir) => [dir, real(dir)]))];
}

function real(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

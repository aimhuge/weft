// A project's snapshot on a Weft Worker (docs/architecture/project-hosts.md, H4): what the desktop board's header
// badges read about a folder, measured on the worker and published as one row (worker_put_project), because a badge
// can't wait on a round trip. The same reads this Mac's routes answer (lib/project-reads.ts), each on its own so one
// that fails is a null badge and the rest still go. Nothing secret goes in: scores, counts and file-free findings.
import path from "node:path";
import { backlogOf, pileOf } from "./project-summaries";
import type { ProjectReads, ProjectSnapshot } from "./project-reads";
import { measureQuality, projectRoot } from "./quality";
import { readScout } from "./scout";
import type { Card } from "./types";

// The row's cap is 64 KB (supabase/migrations/*_worker_projects.sql); a scout report is the part that can run long.
export const SNAPSHOT_MAX = 60_000;

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

// The scout's last report, never a new run: a worker spends tokens on a scout only when a card asks for one.
function cachedScout(cwd: string): ProjectReads["scout"] {
  const report = readScout(projectRoot(cwd));
  return report ? { report, running: false } : null;
}

// A read's root as the folder's name: the badges show only that, and a worker's absolute paths stay on the worker.
function named<T extends { root: string }>(read: T | null | undefined): T | null {
  return read ? { ...read, root: path.basename(read.root) } : null;
}

export function readProjectSnapshot(cwd: string, cards: Card[], now = Date.now()): ProjectSnapshot {
  const scout = attempt(() => cachedScout(cwd));
  const snapshot: ProjectSnapshot = {
    at: now,
    quality: attempt(() => named(measureQuality(cwd))),
    scout: scout?.report ? { ...scout, report: named(scout.report) } : scout,
    pile: attempt(() => named(pileOf(cwd, cards)?.summary)),
    backlog: attempt(() => named(backlogOf(cwd, cards)?.summary)),
  };
  return JSON.stringify(snapshot).length > SNAPSHOT_MAX ? { ...snapshot, scout: null } : snapshot;
}

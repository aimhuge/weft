// What a Weft Worker adds to signed widening (docs/architecture/project-hosts.md#signed-widening-as-built): its own
// pins (lib/host-signers.ts) and nonces, and its limits. A card's new folder names one of its project folders, never a
// path, and runs in that checkout; a read grant stays under its work root. The check itself is lib/widen-check.ts.
import fs from "node:fs";
import path from "node:path";
import { TERMINAL_REFUSAL } from "./host-line-protocol";
import type { HostSigners } from "./host-signers";
import type { Card } from "./types";
import type { WidenChange } from "./widen";
import { widenProblem, type WidenDeps, type WidenTarget } from "./widen-check";
import type { NonceBook } from "./widen-nonces";

export interface WorkerWiden {
  // This worker's id: the host a widening's message names.
  host: string;
  signers: Pick<HostSigners, "verify" | "verifyPasskey" | "endorse"> & Partial<Pick<HostSigners, "approvers">>;
  nonces: NonceBook;
  // The project folders under its work root (lib/worker-folders.ts), and the checkout one names (lib/worker-paths.ts).
  projects(): string[];
  root: string;
  projectPath(folder: string): string;
  // Files a card under its new folder's name, as a run does (lib/worker-publish.ts).
  nameFolder(cardId: string, folder: string): void;
  // Signs with the pairing's sign key (sign-key.json), for a pin's receipt; absent on a token-enrolled box.
  signHeld?: (message: string) => string;
  // The workspace this worker publishes to (its config's orgId) and the folder name a card's row carries
  // (lib/worker-publish.ts folderOf): the names a signed answer is rebuilt from (lib/worker-approve.ts).
  orgId?: string;
  folderOf?: (card: Card) => string;
  now?: () => number;
}

const inside = (child: string, root: string) => {
  const rel = path.relative(root, child);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

// Where a path really lands, symlinks followed, so a link inside a project (`app/up -> /`) isn't under the root.
const real = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

// A worker's limits on a new value: a folder (a card's, a terminal's) is one of its projects by name, a read grant is under its work root. A new
// thread's folder is the run's own, which lib/worker-paths.ts repoPath already keeps under the root.
export function workerConfine(w: Pick<WorkerWiden, "projects" | "root" | "projectPath">, change: WidenChange): string | null {
  for (const folder of [change.cwd, change.terminal]) {
    if (folder === undefined) continue;
    if (!w.projects().includes(folder)) return `${folder} isn't a project on this worker. Pick one of its folders.`;
    // A project folder that's a link out of the work root (`app -> /`) isn't one of its checkouts.
    if (!inside(real(w.projectPath(folder)), real(w.root))) return `${folder} leads out of this worker's projects.`;
  }
  const read = change.readScope;
  const outside = read !== undefined && (typeof read !== "string" || !path.isAbsolute(read) || !inside(path.resolve(read), w.root) || !inside(real(read), real(w.root)));
  return outside ? "A worker card reads only from its own projects' folders." : null;
}

export const workerWidenDeps = (w: WorkerWiden): WidenDeps => ({
  host: w.host,
  now: (w.now ?? Date.now)(),
  nonces: w.nonces,
  verify: (body) => w.signers.verify(body),
  passkey: (body) => w.signers.verifyPasskey(body),
  confine: (change) => workerConfine(w, change),
});

export const workerWidenCheck = (w: WorkerWiden) => (target: WidenTarget, auth: unknown, refusal: string) => widenProblem(target, auth, refusal, workerWidenDeps(w));

// card.update's folder as the worker runs it: the checkout's path for the project name the approval signed, and the
// card filed under that project. Any other verb or body goes through as it came.
export function placeUpdate(w: Pick<WorkerWiden, "projectPath" | "nameFolder">, verb: string, args: Record<string, unknown>, card: Pick<Card, "id">) {
  const body = args.body as Record<string, unknown> | undefined;
  if (verb !== "card.update" || typeof body?.cwd !== "string") return { args, after: () => {} };
  const folder = body.cwd;
  return { args: { ...args, body: { ...body, cwd: w.projectPath(folder) } }, after: () => w.nameFolder(card.id, folder) };
}

// The terminal's check (lib/host-line-terminal.ts): a signed approval for a terminal in one of the worker's project
// folders, and that folder's checkout; throws the refusal otherwise.
export function terminalAllow(w: WorkerWiden) {
  const check = workerWidenCheck(w);
  return async (folder: string, auth: unknown): Promise<string> => {
    const problem = await check({ card: "", verb: "terminal.open", change: { terminal: folder }, args: {} }, auth, TERMINAL_REFUSAL);
    if (problem) throw new Error(problem);
    return w.projectPath(folder);
  };
}

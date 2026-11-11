// A new thread sent to your Weft Worker that the worker turns down (it trusts no Mac yet, an id it had before, a folder
// it can't make) used to vanish: nothing is made on this Mac for a worker project (lib/worker-new-thread.ts), and the
// board's placeholder goes by itself after PENDING_MS (lib/worker-pending-cards.ts). So the prompt was lost with no word.
// Now this Mac's server watches each command it sends, and a refused one lands here, in Needs you on this board: the
// prompt you wrote, in the project of the same name on this Mac, with the worker's reason as its last line.
import os from "node:os";
import path from "node:path";
import { createCardFromBody } from "./new-card";
import { localRepos } from "./repos";
import { updateCard } from "./store";
import type { Card } from "./types";
import { commandResult } from "./workers-account";
import type { WorkerThreadInput } from "./worker-new-thread";
import { parseWorkerProject } from "./worker-project";

export const REFUSED_TAG = "worker-refused";
// How often, and for how long, the server asks after a command. A worker claims a run within seconds when it's up;
// a command still waiting after this is queued for a worker that will run it later, so it's no loss.
export const POLL_MS = 4_000;
export const WATCH_MS = 10 * 60_000;

export interface RefusedDeps {
  read: (id: string) => Promise<{ status: string; error?: string | null }>;
  keep: (input: WorkerThreadInput, worker: string, error: string) => Card;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const DEPS: RefusedDeps = {
  read: (id) => commandResult(id),
  keep: keepRefused,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

// The folder on this Mac a worker project stands for: a repo with the worker folder's name, or home when there's none.
export function localFolderFor(workerCwd: string, repos: { path: string }[] = localRepos()): string {
  const folder = parseWorkerProject(workerCwd)?.folder;
  const match = folder ? repos.find((r) => path.basename(r.path) === folder) : undefined;
  return match?.path ?? os.homedir();
}

export function refusedLine(worker: string, error: string): string {
  return `${worker} didn't take this thread: ${error.replace(/\s+$/, "")} It's here instead: start it on this Mac, or fix ${worker} and send it again.`;
}

// The refused thread as a card on this board, in Needs you, not started: what you wrote, under the worker's reason.
export function keepRefused(input: WorkerThreadInput, worker: string, error: string): Card {
  const { prompt, title, backend, model, effort, permissionMode, agent } = input;
  const tags = [...new Set([...(input.tags ?? []), REFUSED_TAG])];
  const card = createCardFromBody({ prompt, title, backend, model, effort, permissionMode, agent, tags, cwd: localFolderFor(input.cwd) });
  return updateCard(card.id, { column: "needs_you", lastLine: refusedLine(worker, error) });
}

// Asks after one command until the worker has it done or failed, or WATCH_MS passes. Resolves with the kept card on a
// refusal, null otherwise. Never throws: a read that fails is asked again next time.
export async function watchWorkerRun(commandId: string, worker: string, input: WorkerThreadInput, deps: RefusedDeps = DEPS): Promise<Card | null> {
  const until = deps.now() + WATCH_MS;
  while (deps.now() < until) {
    await deps.sleep(POLL_MS);
    const result = await deps.read(commandId).catch(() => null);
    if (result?.status === "done") return null;
    if (result?.status === "failed") return deps.keep(input, worker, result.error || "it gave no reason.");
  }
  return null;
}

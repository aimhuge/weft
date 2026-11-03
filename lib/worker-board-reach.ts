// How this Mac's board tools (lib/board-tools-hosts.ts) reach the user's Weft Workers, server side, as the signed-in
// account: the workers' board and a card's thread from the cloud rows they publish (lib/worker-board.ts), a verb on one
// of their cards as a `host` command, waited on a few seconds for the worker's answer (the same row the board's
// hostOf(card).act sends through /api/worker-board), and a new thread through card.create (lib/worker-new-thread.ts).
// Each loads its module on first use, so a thread's start never pays for the account client. On a worker there is none:
// its own board tools reach the user's board another way (lib/worker-board-tools.ts).
import type { CardVerb } from "@weft/client";
import type { ThreadPage } from "./thread-page";
import type { WaitOptions } from "./worker-command-wait";
import type { WorkerThreadInput } from "./worker-new-thread";
import type { WorkerBoard } from "./worker-project";

export interface WorkerReach {
  board(): Promise<Pick<WorkerBoard, "cards" | "projects">>;
  // A page of a card's thread, newest first, before an index when given; null when it can't be read.
  page(cardId: string, before?: number): Promise<ThreadPage | null>;
  // One verb on a worker's card; `queued` when the worker hasn't taken it yet (it runs once that worker is back).
  act(cardId: string, verb: CardVerb, args: Record<string, unknown>): Promise<{ queued?: true }>;
  start(input: WorkerThreadInput): Promise<{ worker: string; cardId: string }>;
}

// How long a board tool waits on a worker's answer before it says queued.
export const TOOL_ACT_WAIT: WaitOptions = { every: (ask) => Math.min(500 * 2 ** ask, 2_000), unclaimed: 8_000, claimed: 30_000 };

const EMPTY = { cards: [], projects: [] };

export const noWorkers: WorkerReach = {
  board: () => Promise.resolve(EMPTY),
  page: () => Promise.resolve(null),
  act: () => Promise.reject(new Error("This host can't reach your Weft Workers.")),
  start: () => Promise.reject(new Error("This host can't reach your Weft Workers.")),
};

export const accountReach: WorkerReach = {
  async board() {
    const { readWorkerBoard } = await import("./worker-board");
    const { cards, projects } = await readWorkerBoard();
    return { cards, projects };
  },
  async page(cardId, before) {
    const { workerThreadPage } = await import("./worker-board");
    return workerThreadPage(cardId, before);
  },
  async act(cardId, verb, args) {
    const [{ sendWorkerAction }, { waitForCommand }, { commandResult }] = await Promise.all([import("./worker-board"), import("./worker-command-wait"), import("./workers-account")]);
    const { commandId } = await sendWorkerAction({ action: "host", cardId, verb, args: { ...args, id: cardId } });
    const done = await waitForCommand(() => commandResult(commandId), TOOL_ACT_WAIT);
    if (done.status === "failed") throw new Error(done.error || "Your worker couldn't do that.");
    return done.status === "done" ? {} : { queued: true };
  },
  async start(input) {
    const { startWorkerThread } = await import("./worker-new-thread");
    return startWorkerThread(input);
  },
};

// The reach this process's board tools get: none on a worker (WEFT_WORKER=1), the account's on a Mac.
export const workerReach = (env: NodeJS.ProcessEnv = process.env): WorkerReach => (env.WEFT_WORKER === "1" ? noWorkers : accountReach);

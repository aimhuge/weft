import os from "node:os";
import { connection } from "next/server";
import { prewarm } from "@/lib/copilot";
import { elevated, fail, guard } from "@/lib/guard";
import { projectRoot } from "@/lib/repos";
import { createCardFromBody, startCard } from "@/lib/new-card";
import { listProjects } from "@/lib/settings";
import { deleteCard, getCard, listCards } from "@/lib/store";
import type { Card } from "@/lib/types";
import { startWorkerThread, type WorkerThreadInput } from "@/lib/worker-board";
import { handOffToWorker, runsOnWorker } from "@/lib/worker-handoff";
import { isWorkerProject } from "@/lib/worker-project";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  prewarm();
  // The copilot is a thread too, but it has its own window.
  const cards = listCards().filter((c) => c.role !== "copilot");
  // Worktree folders -> their main repo, so the project bar folds them into it.
  const roots: Record<string, string> = {};
  for (const folder of new Set([...cards.map((c) => c.cwd), ...listProjects().map((p) => p.path)])) {
    const root = projectRoot(folder);
    if (root !== folder) roots[folder] = root;
  }
  return Response.json({ cards, home: os.homedir(), roots });
}

// A project switched to "Run on Worker" sends the first message to your worker instead (lib/worker-handoff.ts);
// a failed hand-off drops the card rather than run it here behind your back.
async function begin(card: Card) {
  if (!runsOnWorker(card.cwd)) return startCard(card);
  try {
    return await handOffToWorker(card);
  } catch (err) {
    deleteCard(card.id);
    throw err;
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // A thread may create cards with its curl, but not cards that ask less than the default (lib/guard.ts elevated).
    const loose = body.permissionMode !== undefined && body.permissionMode !== "default" ? elevated(req) : null;
    if (loose) return loose;
    // A worker project has no folder here: a new thread goes to the worker as a run or says why it can't, and no card
    // is made on this Mac. Its cards come back through the cloud rows (lib/worker-board.ts).
    if (isWorkerProject(body.cwd as string | undefined)) {
      if (!body.start) throw new Error("A worker project has no Backlog. Start the thread instead.");
      const { worker } = await startWorkerThread(body as unknown as WorkerThreadInput);
      return Response.json({ card: null, start: { started: false, worker } });
    }
    const card = createCardFromBody(body);
    // A card whose model or CLI is at its limit waits for the window instead of failing its first
    // turn (lib/start-gate.ts); the answer says when its first message goes out.
    const start = body.start ? await begin(card) : { started: false };
    return Response.json({ card: getCard(card.id), start });
  } catch (err) {
    return fail(err);
  }
}

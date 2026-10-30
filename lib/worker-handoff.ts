// "Run on Worker" in a project's right-click menu (lib/project-menu.ts): a project switched to its worker sends each
// new card's first message to your Weft Worker (docs/architecture/weft-worker.md) instead of starting the CLI here.
// The card stays on this board as the record of what went: the prompt, and a note naming the worker, in Review.
// The run itself, and its replies, live on the worker's card, which syncs to the web board.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountClient } from "./account";
import { firstMessage } from "./automations";
import { githubRepoOf, projectRoot } from "./repos";
import { workerFolders } from "./settings";
import { appendThread, updateCard } from "./store";
import type { Card } from "./types";
import { listWorkers, sendRun, type WorkerView } from "./workers-account";

// Whether a card's project runs on the worker. A worktree counts toward its main repo.
export function runsOnWorker(cwd: string): boolean {
  return workerFolders().includes(projectRoot(cwd));
}

// The worker a project's runs go to: one of your headless ones, an online one first. Phase 1 has no per-project
// picker, and a desktop (headed) worker is never picked: it's a Mac whose board you'd hand work to by hand.
export function pickWorker(workers: WorkerView[]): WorkerView | undefined {
  const mine = workers.filter((w) => w.mine && w.kind !== "desktop");
  return mine.find((w) => w.status === "online") ?? mine.find((w) => w.status === "busy") ?? mine[0];
}

// Throws when there's no worker of yours to switch a project to, so the menu can say so instead of switching.
export async function requireWorker(client: SupabaseClient = accountClient()): Promise<WorkerView> {
  const view = await listWorkers(client);
  if (!view.signedIn) throw new Error("Sign in to Weft to run on a worker.");
  const worker = pickWorker(view.workers);
  if (!worker) throw new Error("You have no Weft Worker yet. Add one in Settings → Sync → Workers.");
  return worker;
}

// Sends the card's first message to the worker, under the project's folder name and its GitHub remote (cloned the
// first time), and records on the card what went where.
export async function handOffToWorker(card: Card, client: SupabaseClient = accountClient()): Promise<{ started: false; worker: string }> {
  const worker = await requireWorker(client);
  const root = projectRoot(card.cwd);
  const slug = githubRepoOf(root);
  const prompt = firstMessage(card);
  await sendRun({ workerId: worker.id, folder: path.basename(root), prompt, repo: slug ? `https://github.com/${slug}.git` : undefined }, client);
  const at = Date.now();
  appendThread(card.id, { kind: "user", text: prompt, at });
  appendThread(card.id, { kind: "assistant", text: `Sent to your worker **${worker.name}** (${worker.status}). It runs there, not on this machine; follow and reply to it under ${worker.name}'s project on this board, or on the weft.zip board.`, at });
  updateCard(card.id, { column: "review" });
  return { started: false, worker: worker.name };
}

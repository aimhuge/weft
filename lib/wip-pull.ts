// "Pull Uncommitted Work from <worker>" in a project's menu (docs/architecture/wip-sync.md): you sit down at this Mac
// and ask the Weft Worker that has the same project for its uncommitted work. The worker builds a snapshot and pushes
// it to its hidden ref when asked (the tree.snapshot verb, lib/host-api/tree-snapshot.ts); this Mac fetches that ref and
// makes its own working tree match (lib/wip-snapshot.ts applyWip, which refuses rather than lose work of this Mac's).
import path from "node:path";
import { deviceId } from "./device-id";
import { projectRoot } from "./repos";
import { busyCards } from "./runner-state";
import { getCard } from "./store";
import { applyWip, fetchWip, type Applied } from "./wip-snapshot";
import { waitForCommand, type CommandResult } from "./worker-command-wait";
import { sendWorkerHostVerb } from "./worker-host-verbs";
import { parseWorkerProject } from "./worker-project";
import { commandResult } from "./workers-account";

// A worker polls every 3 s; the snapshot and its push take seconds, a first push of a big tree longer.
const WAIT = { every: 1_000, unclaimed: 20_000, claimed: 120_000 };

export interface Pulled extends Applied {
  // Threads mid-turn on the worker when the snapshot was taken: their edits may be half done.
  running: number;
}

export interface PullDeps {
  send: (workerId: string, folder: string) => Promise<{ commandId: string }>;
  wait: (commandId: string) => Promise<CommandResult>;
  fetch: typeof fetchWip;
  apply: typeof applyWip;
  self: () => string;
  root: (folder: string) => string;
  // The folders of the threads running on this Mac now.
  busy: () => string[];
}

const DEFAULTS: PullDeps = {
  send: (workerId, folder) => sendWorkerHostVerb({ workerId, verb: "tree.snapshot", args: { folder } }),
  wait: (commandId) => waitForCommand(() => commandResult(commandId), WAIT),
  fetch: fetchWip,
  apply: applyWip,
  self: deviceId,
  root: projectRoot,
  busy: () => busyCards().flatMap((id) => getCard(id)?.cwd ?? []),
};

const threads = (n: number) => (n === 1 ? "1 thread" : `${n} threads`);

// What the worker answered, or why it didn't.
function answered(done: CommandResult): { running: number } {
  if (done.status === "pending") throw new Error("That worker didn't answer. Is it online?");
  if (done.status === "claimed") throw new Error("That worker is still sending its work. Try again in a moment.");
  const result = done.result as { ok?: boolean; error?: string; value?: { running?: number } } | undefined;
  if (done.status === "failed" || !result?.ok) throw new Error(done.error ?? result?.error ?? "That worker couldn't send its work.");
  return { running: Number(result.value?.running) || 0 };
}

export async function pullWip(folder: string, from: string, deps: PullDeps = DEFAULTS): Promise<Pulled> {
  const source = parseWorkerProject(from);
  if (!source) throw new Error("Pick one of your Weft Workers' projects to pull from.");
  const root = deps.root(folder);
  const running = deps.busy().filter((cwd) => cwd === root || cwd.startsWith(root + path.sep)).length;
  if (running) throw new Error(`${threads(running)} still running in ${path.basename(root)} here. Stop ${running === 1 ? "it" : "them"} first: a pull rewrites the files under ${running === 1 ? "it" : "them"}.`);
  const { commandId } = await deps.send(source.workerId, source.folder);
  const worker = answered(await deps.wait(commandId));
  if (!(await deps.fetch(root, source.workerId))) throw new Error("That worker's work didn't reach the project's remote. Can it push there?");
  return { ...(await deps.apply(root, source.workerId, deps.self())), running: worker.running };
}

// The toast after a pull.
export function pulledNote(p: Pick<Pulled, "mac" | "changed" | "install" | "running">): string {
  const what = p.changed ? `Pulled ${p.changed === 1 ? "1 file" : `${p.changed} files`} of uncommitted work from ${p.mac}.` : `Already level with ${p.mac}.`;
  const install = p.install ? " A lockfile changed: install dependencies." : "";
  const live = p.running ? ` ${threads(p.running)} still running there, so more may follow.` : "";
  return what + install + live;
}

// A card's dev server, from the board's Services drawer (docs/architecture/dev-servers.md#on-a-worker). On a worker the
// board can't reach its localhost, so `dev.open` gives the server a private /t/<id> address: a tunnel, after the owner's
// Touch ID on their Mac (lib/tunnel-worker.ts). On the Mac the same verb opens a Mac tunnel. `dev.stop` ends the run,
// `dev.restart` starts it again with the same command, and `dev.log` reads its last lines (T5). `dev.start` runs the
// review tour's dev command (its plan, card.review) and `dev.status` says whether the server answers: the review tour's
// Start and Restart, and its status line.
import { listDev } from "../devserver-list";
import { devStatus, LOG_LIMIT, reachable, restartDev, runs, startDev, stopDev } from "../devserver";
import { redactText } from "../share-redact";
import { openTunnel } from "../tunnels";
import type { DevServerStatus } from "../types";
import { workDir } from "../work-dir";
import { OK, requireCard, settle, type Ok } from "./types";

type Status = { status: DevServerStatus };

export async function devStatusVerb({ id }: { id: string }): Promise<Status> {
  return { status: await devStatus(id, requireCard(id).review?.url) };
}

// The plan's dev command, unless its url already answers; `restart` stops Weft's run first and starts it anew.
export async function devStartVerb({ id, restart }: { id: string; restart?: boolean }): Promise<Status> {
  const card = requireCard(id);
  const plan = card.review;
  if (!plan?.dev) throw new Error("The review tour has no dev command.");
  if (restart === true) stopDev(id);
  else if (plan.url && (await reachable(plan.url))) return { status: await devStatus(id, plan.url) };
  const { url } = await startDev(id, plan.dev, workDir(card), card.title, plan.url);
  return { status: await devStatus(id, url) };
}

export async function devOpenVerb({ id }: { id: string }): Promise<{ address: string }> {
  const card = requireCard(id);
  const entry = (await listDev()).find((e) => e.cardId === id && e.url);
  if (!entry?.url) throw new Error("That card has no dev server with a url to open.");
  const tunnel = await openTunnel({ folder: card.cwd, target: entry.url, cardId: id });
  return { address: `${tunnel.address}${new URL(entry.url).pathname.replace(/^\/$/, "")}` };
}

export function devStopVerb({ id }: { id: string }): Promise<Ok> {
  return settle(() => {
    requireCard(id);
    stopDev(id);
    return OK;
  });
}

// A run Weft started for the card, or a refusal naming why there's none: a server a thread started in its own shell
// has no command or log Weft holds, so it can only be stopped.
function weftRun(id: string) {
  requireCard(id);
  const run = runs.get(id);
  if (!run) throw new Error("Weft didn't start that card's dev server, so it can only stop it.");
  return run;
}

export async function devRestartVerb({ id }: { id: string }): Promise<Ok> {
  weftRun(id);
  await restartDev(id);
  return OK;
}

// The newest lines of the run's output, key-shaped text hidden: it leaves the host in a command's result.
export const DEV_LOG_LINES = 40;

// A log at its cap was cut mid-line, so its first line is a fragment: half a key no pattern knows. It's dropped.
export function devLogVerb({ id }: { id: string }): Promise<{ log: string }> {
  return settle(() => {
    const log = weftRun(id).log;
    const lines = log.split("\n");
    if (log.length >= LOG_LIMIT) lines.shift();
    return { log: redactText(lines.join("\n").trim().split("\n").slice(-DEV_LOG_LINES).join("\n")) };
  });
}

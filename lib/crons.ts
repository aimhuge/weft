import { randomUUID } from "node:crypto";
import { parseCron, nextRun } from "./cron-schedule";
import { getCron, listCrons, removeCron, saveCron } from "./cron-store";
import { RUNS_KEPT, type Cron, type CronInput, type CronPatch, type CronRun } from "./cron-types";
import { resolveFolder } from "./folders";
import { cleanTitle, titleFromPrompt } from "./format";
import { panePage } from "./pane-page";
import { sessionRewindPoint, sessionTip } from "./rewind";
import { defaultPermissionMode } from "./settings";
import { getCard, getThread } from "./store";
import type { Card } from "./types";

// Making, changing and deleting crons (docs/architecture/crons.md). lib/cron-run.ts runs them on the scheduler's tick.

// The CLIs whose sessions Weft can fork at a message: the Agent SDK's resume with resumeSessionAt.
const FORKABLE = new Set<Card["backend"]>(["claude", "puku"]);

// The next run strictly after `after`, inside the cron's start and end; none when it's off.
export function nextFor(cron: Pick<Cron, "expr" | "enabled" | "startsAt" | "endsAt">, after: number): number | undefined {
  if (!cron.enabled) return undefined;
  const from = Math.max(after, (cron.startsAt ?? 0) - 60_000);
  const at = nextRun(cron.expr, from);
  return at !== undefined && (cron.endsAt === undefined || at <= cron.endsAt) ? at : undefined;
}

function requirePrompt(raw: string | undefined): string {
  const prompt = (raw ?? "").trim();
  if (!prompt) throw new Error("Write what each run should do.");
  return prompt;
}

// Where a fork run starts: the source's session at the message (its turn and what came after dropped, the
// message itself re-sent as the run's prompt), or the whole session as it is now. A message that opened the
// session forks nothing: each run is a fresh thread with the same folder and model.
function forkPoint(source: Card, fromMessage?: string): Pick<Cron, "sessionId" | "resumeAt" | "page"> {
  if (!source.sessionId || !FORKABLE.has(source.backend)) {
    throw new Error("Only a Claude Code or puku thread that has run can be forked on a cron; pick Fresh thread instead.");
  }
  if (!fromMessage) return { sessionId: source.sessionId, resumeAt: sessionTip(source.sessionId), page: panePage(source.id) };
  const item = getThread(source.id).find((i) => i.kind === "user" && i.id === fromMessage);
  if (!item || item.kind !== "user") throw new Error("That message isn't in this thread.");
  const at = sessionRewindPoint(source.sessionId, fromMessage);
  if (at === undefined) throw new Error("Weft can't find that message in the thread's session, so it can't fork there.");
  return at === null ? { page: item.page } : { sessionId: source.sessionId, resumeAt: at, page: item.page ?? panePage(source.id) };
}

function sourceOf(input: CronInput): Card | undefined {
  if (!input.cardId) return undefined;
  const card = getCard(input.cardId);
  if (!card) throw new Error("No such card.");
  if (card.role === "copilot") throw new Error("The copilot can't run on a cron.");
  return card;
}

// Where and how each run's card works: the source card's folder, CLI, mode, model and effort, or what was sent.
function workOf(input: CronInput, source?: Card): Pick<Cron, "cwd" | "backend" | "permissionMode" | "model" | "effort"> {
  if (source) return { cwd: source.cwd, backend: source.backend, permissionMode: source.permissionMode, model: source.model, effort: source.effort };
  return {
    cwd: resolveFolder(input.cwd),
    backend: input.backend ?? "claude",
    permissionMode: input.permissionMode ?? defaultPermissionMode(),
    model: input.model,
    effort: input.effort,
  };
}

// No run before startsAt and none after endsAt; either may be left out.
function windowOf(input: CronInput): Pick<Cron, "startsAt" | "endsAt"> {
  const { startsAt, endsAt } = input;
  if (startsAt && endsAt && endsAt < startsAt) throw new Error("It ends before it starts.");
  return { ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) };
}

export function createCron(input: CronInput, now = Date.now()): Cron {
  const prompt = requirePrompt(input.prompt);
  const expr = input.expr.trim();
  parseCron(expr);
  const source = sourceOf(input);
  const mode = input.mode ?? (source ? "fork" : "fresh");
  const forked = mode === "fork" && source;
  const cron: Cron = {
    id: randomUUID(),
    // A fork is named after its thread, a fresh one after its prompt.
    name: cleanTitle(input.name ?? "") || (forked ? source.title : titleFromPrompt(prompt, 40)),
    prompt,
    expr,
    mode,
    ...workOf(input, source),
    ...(source ? { sourceId: source.id } : {}),
    ...(forked ? forkPoint(source, input.fromMessage) : {}),
    enabled: input.enabled ?? true,
    by: input.by ?? "you",
    count: 0,
    runs: [],
    ...windowOf(input),
    createdAt: now,
    updatedAt: now,
  };
  return saveCron({ ...cron, nextAt: nextFor(cron, now) });
}

export function updateCron(id: string, patch: CronPatch, now = Date.now()): Cron {
  const cron = getCron(id);
  if (!cron) throw new Error("No such cron.");
  const next: Cron = { ...cron, ...patch, updatedAt: now };
  if (patch.prompt !== undefined) next.prompt = requirePrompt(patch.prompt);
  if (patch.expr !== undefined) next.expr = patch.expr.trim();
  if (patch.name !== undefined) next.name = cleanTitle(patch.name) || cron.name;
  if (patch.mode === "fork" && !cron.sessionId) throw new Error("This cron has no thread to fork; its runs start fresh.");
  parseCron(next.expr);
  return saveCron({ ...next, nextAt: nextFor(next, now) });
}

export function deleteCron(id: string): void {
  if (!removeCron(id)) throw new Error("No such cron.");
}

// After a run: counted, kept on file, and the next one after now (runs it missed while the Mac slept don't stack up).
export function recordRun(cron: Cron, run: CronRun, now: number): Cron {
  const runs = [...cron.runs, run].slice(-RUNS_KEPT);
  const ran = { ...cron, count: Math.max(cron.count, run.n), runs, updatedAt: now };
  return saveCron({ ...ran, nextAt: nextFor(ran, now) });
}

// The crons a card's ⏰ shows: the ones made from it.
export function cronsFrom(cardId: string): Cron[] {
  return listCrons().filter((c) => c.sourceId === cardId);
}

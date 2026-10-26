import path from "node:path";
import { firstMessage } from "./automations";
import { getCron, listCrons } from "./cron-store";
import type { Cron } from "./cron-types";
import { recordRun } from "./crons";
import { restartArmed } from "./restart-when-idle";
import { panePage } from "./pane-page";
import { isBusy, sendMessage } from "./runner";
import { scheduleMessage } from "./scheduler";
import { startGate } from "./start-gate";
import { createCard, DATA_DIR, getCard } from "./store";
import { startClock } from "./tick-clock";
import type { Card } from "./types";

// A cron's runs (docs/architecture/crons.md): each one a new card, forked from the source thread or fresh, that
// opens on the source's page and ends with a run page of its own. lib/scheduler.ts calls runDueCrons every tick.

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// Where a run's page goes, under ~/.weft/show so it stays after a restart and the drawer can find it.
export function runPagePath(cron: Pick<Cron, "id">, n: number): string {
  return path.join(DATA_DIR, "show", "crons", cron.id, `run-${n}.html`);
}

// Said with the prompt, in the thread, so the run knows what it is and where its page goes.
export function runNote(cron: Cron, n: number): string {
  return `⏰ This is run ${n} of the cron “${cron.name}”. End it with a page of what this run did at ${runPagePath(cron, n)}, open in the browser pane.`;
}

// The card a run's card folds under on the board: the source thread, or the cron's oldest run still on the board.
function stackHolder(cron: Cron): string | undefined {
  const live = (id?: string) => (id && getCard(id) && !getCard(id)?.archived ? id : undefined);
  return live(cron.sourceId) ?? cron.runs.map((r) => live(r.cardId)).find(Boolean);
}

function runCard(cron: Cron, n: number, now: number): Card {
  const fork = cron.mode === "fork" && cron.sessionId;
  return createCard({
    title: `${cron.name} · ${dayLabel(now)}`,
    titleBy: "user",
    prompt: `${cron.prompt}\n\n${runNote(cron, n)}`,
    cwd: cron.cwd,
    backend: cron.backend,
    permissionMode: cron.permissionMode,
    model: cron.model,
    effort: cron.effort,
    ...(cron.agent ? { agent: cron.agent } : {}),
    cronId: cron.id,
    cronRun: n,
    cronOf: stackHolder(cron),
    ...(fork ? { forkOf: { sessionId: cron.sessionId as string, ...(cron.resumeAt ? { at: cron.resumeAt } : {}) } } : {}),
  });
}

// The page the run opens on: a fork's anchor page, or the source thread's latest. A fresh run gets the usual starter.
async function openSourcePage(cron: Cron, cardId: string) {
  const url = cron.mode === "fork" ? cron.page ?? (cron.sourceId ? panePage(cron.sourceId) : undefined) : undefined;
  if (!url) return;
  // Loaded here, not at import: the board MCP tools import this file, and ./browser-tools reads the store as it loads.
  const { openInPane } = await import("./browser-tools");
  await openInPane(url, cardId).catch(() => {});
}

// One run, now: the card is made and its first turn sent (or held for the model's reset, like a new thread).
export async function runCron(id: string, now = Date.now()): Promise<Card> {
  const cron = getCron(id);
  if (!cron) throw new Error("No such cron.");
  const n = cron.count + 1;
  const card = runCard(cron, n, now);
  recordRun(cron, { cardId: card.id, n, at: now }, now);
  await openSourcePage(cron, card.id);
  const gate = startGate(card.backend, card.model);
  if (gate) scheduleMessage(card.id, firstMessage(card), gate.at);
  else sendMessage(card.id, firstMessage(card));
  return card;
}

// The last run is still going: the next one waits for it rather than piling up.
function stillRunning(cron: Cron): boolean {
  const last = cron.runs[cron.runs.length - 1];
  const card = last && getCard(last.cardId);
  return Boolean(card && (isBusy(card.id) || card.column === "running"));
}

// Every enabled cron whose time has come, one run each. A failed run is kept on file with its error.
export async function runDueCrons(now = Date.now()) {
  // A restart is waiting for the running turns to end; what is due runs once Weft is back.
  if (restartArmed()) return;
  for (const cron of listCrons()) {
    if (!cron.enabled || cron.nextAt === undefined || cron.nextAt > now || stillRunning(cron)) continue;
    try {
      await runCron(cron.id, now);
    } catch (err) {
      const fresh = getCron(cron.id) ?? cron;
      recordRun(fresh, { cardId: "", n: fresh.count, at: now, error: err instanceof Error ? err.message : String(err) }, now);
    }
  }
}

// Once per server process, on the same 15-second beat as the scheduled messages' check. A run that
// came due while the Mac slept or Weft was closed goes on the first check.
export function startCronClock() {
  startClock("cron", () => void runDueCrons().catch((err: unknown) => console.error("[weft] cron check failed:", err)));
}

import { randomUUID } from "node:crypto";
import { shell } from "./browser-tools";
import { publish, subscribe } from "./bus";
import { globalSingleton } from "./global-singleton";
import { busyCards, queued } from "./runner-state";
import { addScheduled } from "./schedule";
import { getCard, updateCard } from "./store";
import type { RestartStatus } from "./types";

// Restart when idle: restarting Weft cuts off every running turn, so instead you arm a restart. From then no new
// turn starts (lib/runner.ts asks holdForRestart first): a message sent to a card waits on its card, due now,
// which lib/scheduler.ts sends once Weft is back. When the last running turn ends, the server asks Electron
// main to relaunch, or to install the downloaded update (electron/main.cjs "POST /app/restart").
//
// The drain lives in memory only, and the restart itself disarms it. But globalSingleton outlives a supervised
// dev-server restart (globalThis is shared with the next `next dev` Electron respawns), so a drain armed by a
// dying process would otherwise still be sitting here, still armed, and would fire again ~SETTLE_MS after the
// new server came up: Weft relaunching itself every few seconds. Each drain therefore records the id of the
// server generation that armed it, and a new generation disarms an inherited one on boot.

export type RestartThen = NonNullable<RestartStatus["then"]>;

// A queued message goes out a tick after its card's turn ends, so the board only counts as idle once it has stayed
// idle this long.
export const SETTLE_MS = 1_000;

export const COPILOT_HELD = "Weft restarts once the running threads finish, so the copilot is paused until then.";
export const RERUN_HELD = "Weft restarts once the running threads finish, so this can't run now. Run it again after the restart.";

// This server generation's id, fresh per process. A drain armed by another one is left over from a server that
// has since been replaced, so it must not fire.
const GENERATION = randomUUID();

interface Drain {
  then: RestartThen;
  stop: () => void;
  timer?: ReturnType<typeof setTimeout>;
  // The status last published, so a card event that changes nothing stays quiet.
  last?: string;
  // The server generation that armed this drain; a mismatch means it survived that generation's death.
  generation?: string;
  // The card whose thread asked for the restart, so the board can mark it (lib/restart-tool.ts).
  requestedBy?: { id: string; title: string };
}

const state = globalSingleton("__weftRestart", () => ({ drain: undefined as Drain | undefined }));

// A drain inherited from a previous server process, whose restart already happened (or was lost when it died).
// Cleared once on boot, before anything can read it, so it can't restart Weft a second time.
const inherited = state.drain;
if (inherited && inherited.generation !== undefined && inherited.generation !== GENERATION) {
  console.warn(
    `[weft] clearing a restart-when-idle drain left armed by a previous server process (armed for "${inherited.then}"); it would have restarted Weft again`,
  );
  inherited.stop();
  clearTimeout(inherited.timer);
  state.drain = undefined;
}

export function restartArmed(): boolean {
  return state.drain !== undefined;
}

// The cards the restart waits on: running a turn now, or with queued messages still to run.
function waiting(): RestartStatus["waiting"] {
  const ids = new Set([...busyCards(), ...queued.keys()]);
  return [...ids].map((id) => ({ id, title: getCard(id)?.title ?? "A thread" }));
}

export function restartStatus(): RestartStatus {
  const drain = state.drain;
  return drain
    ? { armed: true, then: drain.then, waiting: waiting(), ...(drain.requestedBy && { requestedBy: drain.requestedBy }) }
    : { armed: false, waiting: waiting() };
}

// Arms the restart, or turns an armed relaunch into an update. With nothing running it restarts after SETTLE_MS.
// `cardId` is the card whose thread asked for it, when one did (lib/restart-tool.ts): the board marks that card, so
// you can see which one is waiting on a restart. A restart asked for from the menu or the palette has no card.
export function armRestart(then: RestartThen = "relaunch", cardId?: string): RestartStatus {
  if (!process.env.WEFT_SHELL_URL) throw new Error("Restarting Weft needs the desktop app.");
  console.warn(`[weft] restart-when-idle armed (${then}), generation ${GENERATION}`);
  let drain = state.drain;
  if (drain) {
    if (then === "update") drain.then = "update";
    // A second card asking while the drain is armed: the newest asker is the one to mark.
    if (cardId) drain.requestedBy = askingCard(cardId);
  } else {
    const armed = { then, generation: GENERATION, ...(cardId && { requestedBy: askingCard(cardId) }) } as Drain;
    armed.stop = subscribe((event) => {
      if (event.type === "card") check(armed);
    });
    drain = state.drain = armed;
  }
  check(drain);
  return restartStatus();
}

// The card a restart was asked for, with the title it has now: the board shows it on the card.
function askingCard(cardId: string): { id: string; title: string } {
  return { id: cardId, title: getCard(cardId)?.title ?? "A thread" };
}

function disarm(error?: string): RestartStatus {
  const drain = state.drain;
  if (drain) {
    console.warn(`[weft] restart-when-idle disarmed${error ? `: ${error}` : ""} (was ${drain.then})`);
    drain.stop();
    clearTimeout(drain.timer);
    state.drain = undefined;
  }
  const status = { ...restartStatus(), ...(error && { error }) };
  publish({ type: "restart", restart: status });
  return status;
}

export function cancelRestart(): RestartStatus {
  return disarm();
}

// Tells the board what the restart waits on when that changed, and restarts once nothing has run for SETTLE_MS.
function check(drain: Drain) {
  const status = restartStatus();
  const key = JSON.stringify(status);
  if (key !== drain.last) {
    drain.last = key;
    publish({ type: "restart", restart: status });
  }
  clearTimeout(drain.timer);
  if (status.waiting.length) return;
  drain.timer = setTimeout(() => {
    if (state.drain === drain && !waiting().length) void restartNow(drain);
  }, SETTLE_MS);
}

// Stays armed while Electron quits, so nothing starts in the meantime.
async function restartNow(drain: Drain) {
  try {
    console.warn(`[weft] restart-when-idle firing: asking Electron to ${drain.then} (generation ${drain.generation})`);
    await shell("/app/restart", { then: drain.then });
  } catch (err) {
    if (state.drain === drain) disarm(`Weft couldn't restart: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// While a restart is armed, keeps a message from starting a turn: it waits on its card, due now, so it goes out
// first thing after the restart (or on the scheduler's next check, if you cancel). False when nothing's armed.
// The copilot takes no scheduled messages, and a re-run of the last message (echo off) would show it twice, so
// both are told why instead.
export function holdForRestart(cardId: string, text: string, { echo = true } = {}): boolean {
  if (!state.drain) return false;
  if (!echo) throw new Error(RERUN_HELD);
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.role === "copilot") throw new Error(COPILOT_HELD);
  const held = { id: randomUUID(), text, at: Date.now(), afterRestart: true };
  updateCard(cardId, { scheduled: addScheduled(card.scheduled, held) });
  return true;
}

import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { restartTarget, weftProcess, type WeftProcess } from "./restart-guard";
import { DATA_DIR, getCard, getThread, listCards, updateCard } from "./store";
import type { Card, CardBreak, ThreadItem } from "./types";

// Which card broke Weft. Every card runs in one Next server, so a thread that kills it (a second `pnpm dev` in
// Weft's folder frees the board's port), leaves a file that doesn't build, or edits one Fast Refresh can't swap
// takes the board down for everyone, and the user only sees Weft restart. Each of those three gets reported here
// with its time (the server's exit from Electron, the other two from the board), the thread items just before it
// are weighed, and the card that did it gets Card.broke: a red ring and a chip on the board, and a note to the
// thread with its next message (docs/architecture/error-boundaries.md).

export type BreakKind = CardBreak["kind"];
export interface Breakage {
  kind: BreakKind;
  at: number;
  // The file that doesn't build, as Next's overlay names it ("./components/Board.tsx (10:2)").
  file?: string;
}

export interface Suspect {
  cardId: string;
  at: number;
  score: number;
  why: string;
  file?: string;
}

type Tool = Extract<ThreadItem, { kind: "tool" }>;

// How far back a tool call can be the cause: a kill lands within seconds, a reload after one within a few, and a
// build error stays up until the file is fixed.
const WINDOW_MS: Record<BreakKind, number> = { server: 15_000, reload: 8_000, build: 30 * 60_000 };
// A reload or a second report this soon after a server stop is the same incident.
const SAME_INCIDENT_MS = 60_000;
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const COMMANDS = new Set(["Bash", "mcp__devservers__start"]);

// "./components/Board.tsx (10:2)" → the absolute path in Weft's folder.
export function overlayFile(file: string, dir: string) {
  return path.resolve(dir, file.replace(/\s*\(\d+:\d+\)$/, ""));
}

// How well one tool call explains the breakage: 3 for a command that stops Weft, 2 for an edit to the file that
// doesn't build. Null when it doesn't. An edit just before a reload proves nothing (every full reload Next logged on
// 2026-10-23/24 was its own app-bootstrap.js, none a card's file), so a reload is blamed only on a command that stops Weft.
export function suspicion(item: Tool, cwd: string, event: Breakage, weft: WeftProcess): Omit<Suspect, "cardId" | "at"> | null {
  if (COMMANDS.has(item.name)) {
    // A command a guard refused (or that failed to start) stopped nothing; one that stopped Weft never got a result.
    if (item.isError) return null;
    const command = item.summary.replace(/…$/, "");
    const target = command ? restartTarget(command, cwd, weft) : null;
    return target ? { score: 3, why: `its \`${command}\` stopped Weft (${target})` } : null;
  }
  if (!EDITS.has(item.name) || !item.file) return null;
  const file = path.resolve(cwd, item.file);
  if (event.kind !== "build" || !event.file || overlayFile(event.file, weft.dir) !== file) return null;
  const rel = path.relative(weft.dir, file);
  return { score: 2, why: `its edit to ${rel} doesn't build`, file: rel };
}

// The card most likely to have done it: the strongest suspicion in the window, the latest of equals.
export function blame(cards: readonly Card[], threadOf: (id: string) => ThreadItem[], event: Breakage, weft: WeftProcess): Suspect | null {
  const from = event.at - WINDOW_MS[event.kind];
  const to = event.at + 1000;
  let best: Suspect | null = null;
  for (const card of cards) {
    if (card.archived || !card.cwd) continue;
    const items = threadOf(card.id);
    // Threads are in time order, so walk back from the end and stop once past the window.
    for (const item of [...items].reverse()) {
      if (item.at < from) break;
      if (item.kind !== "tool" || item.at > to) continue;
      const hit = suspicion(item, card.cwd, event, weft);
      if (hit && (!best || hit.score > best.score || (hit.score === best.score && item.at > best.at))) best = { cardId: card.id, at: item.at, ...hit };
    }
  }
  return best;
}

// The card's mark after this breakage: a new one, or the one it has with the count raised when it did it again.
export function nextBreak(prev: CardBreak | undefined, event: Breakage, suspect: Suspect): CardBreak | undefined {
  const same = prev && prev.kind === event.kind && prev.why === suspect.why;
  if (same && Math.abs(event.at - prev.at) < SAME_INCIDENT_MS) return undefined;
  return {
    kind: event.kind,
    at: event.at,
    why: suspect.why,
    ...(suspect.file && { file: suspect.file }),
    ...(prev && { times: (prev.times ?? 1) + 1 }),
  };
}

const last = globalSingleton("__weftLastServerBreak", () => ({ at: 0 }));

// Weighs a breakage against every card's recent tool calls and marks the card that did it. Returns that card, or
// undefined when nothing on the board explains it (the user pressed ⌘R, Next crashed by itself).
export function recordBreak(event: Breakage, weft: WeftProcess = weftProcess()): Card | undefined {
  // The board reloads when the server comes back; that's the stop already counted.
  if (event.kind !== "server" && event.at - last.at < SAME_INCIDENT_MS && event.at >= last.at) return undefined;
  const suspect = blame(listCards(), getThread, event, weft);
  if (!suspect) return undefined;
  if (event.kind === "server") last.at = event.at;
  const mark = nextBreak(getCard(suspect.cardId)?.broke, event, suspect);
  return mark ? updateCard(suspect.cardId, { broke: mark }) : getCard(suspect.cardId);
}

// Electron writes this when the server it supervises exits without Weft asking (electron/server.cjs).
export const SERVER_EXIT_FILE = () => path.join(DATA_DIR, "server-exit.json");

// Once per server start (lib/copilot.ts prewarm): the last server's unexpected exit, if there was one, gets blamed.
export function consumeServerExit(file = SERVER_EXIT_FILE()): Card | undefined {
  let at: unknown;
  try {
    at = (JSON.parse(fs.readFileSync(file, "utf8")) as { at?: unknown }).at;
    fs.rmSync(file, { force: true });
  } catch {
    return undefined;
  }
  return typeof at === "number" ? recordBreak({ kind: "server", at }) : undefined;
}

const ADVICE: Record<BreakKind, string> = {
  server:
    "Weft runs from its own folder's dev server, and every card's turn runs inside it, so stopping it cut them all off. Never start, kill or restart it (no `pnpm dev` there, no freeing its port); when Weft needs a restart, call mcp__board__restart_weft_when_idle.",
  build: "Weft kept running the last version that built until it was fixed. Make sure a file parses before you leave it.",
  reload:
    "Weft runs from its own folder's dev server, and every card's turn runs inside it, so restarting it cut them all off. Never start, kill or restart it (no `pnpm dev` there, no freeing its port); when Weft needs a restart, call mcp__board__restart_weft_when_idle.",
};

// What the thread is told ahead of its next message, once: what it did to Weft and how not to again. "" when nothing.
export function takeBreakNote(cardId: string): string {
  const broke = getCard(cardId)?.broke;
  if (!broke || broke.told) return "";
  updateCard(cardId, { broke: { ...broke, told: true } });
  const when = new Date(broke.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const what = { server: "Weft's server stopped", build: "Weft stopped building", reload: "Weft's board reloaded" }[broke.kind];
  const times = broke.times ? ` (${broke.times} times so far)` : "";
  return `[Weft] At ${when} ${what}${times}: ${broke.why}. ${ADVICE[broke.kind]}\n\n`;
}

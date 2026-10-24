import { COLD_MIN_TOKENS } from "./reply-mode";
import { endSession, isBusy, sendMessage, sendUserMessage } from "./runner";
import { open } from "./runner-session";
import { specFor } from "./runner-state";
import { briefFor, prebakeBrief } from "./splice-brief";
import { appendThread, getCard, listCards, updateCard } from "./store";

// "Send fresh": a card whose prompt cache has gone cold would re-send its whole thread at full price on the next
// message. Instead the card stays, and so does its thread on screen, but the CLI starts a new session whose first
// message carries a brief (lib/splice-brief.ts: summary, what's open, the scoped diff) ahead of what you typed.
// A "spliced" row in the thread marks where the new session begins (docs/architecture/composer.md).

// `echo: false` re-sends a message the thread already shows (lib/lost-session.ts), without a second user row.
export async function sendFresh(cardId: string, text: string, { echo = true } = {}): Promise<void> {
  const card = getCard(cardId);
  if (!card) throw new Error("No such card.");
  if (card.backend === "codex") throw new Error("Codex threads resume their own session; send it here instead.");
  if (isBusy(cardId)) throw new Error("This thread is already running.");
  if (!text.trim()) throw new Error("Write a message first.");
  const brief = await briefFor(card);
  await endSession(cardId);
  const tokens = card.stats?.cache?.tokens;
  updateCard(cardId, { sessionId: undefined, forkedFrom: undefined, stats: card.stats && { ...card.stats, cache: undefined } });
  appendThread(cardId, { kind: "spliced", at: Date.now(), brief, ...(tokens !== undefined && { tokens }) });
  const session = open({ ...specFor({ ...card, sessionId: undefined }), sessionId: undefined }, cardId);
  // puku's own first-message context (lib/puku-context.ts) stays ahead of the brief.
  session.preamble = `${session.preamble ?? ""}${brief}`;
  if (echo) sendUserMessage(cardId, text);
  else sendMessage(cardId, text, { echo: false });
}

// How long before a cache lapses its card's brief is written, so "Send fresh" doesn't wait on Haiku.
const PREBAKE_LEAD_MS = 5 * 60_000;

// Past this, a lapsed card's brief waits to be written until you send (a server start shouldn't summarize old cards).
const PREBAKE_STALE_MS = 6 * 3600_000;

// From the scheduler's tick: each idle card big enough to offer "Send fresh", whose cache lapses within the lead
// (or did in the last few hours), gets its summary written once.
export function prebakeBriefs(now = Date.now()) {
  for (const card of listCards()) {
    const cache = card.stats?.cache;
    if (!cache || cache.tokens < COLD_MIN_TOKENS || card.backend === "codex" || card.archived || isBusy(card.id)) continue;
    const left = cache.at + cache.ttl * 1000 - now;
    if (left > PREBAKE_LEAD_MS || left < -PREBAKE_STALE_MS || card.column === "done") continue;
    prebakeBrief(card.id).catch(() => {});
  }
}

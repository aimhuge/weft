// How a card or its thread is shown in the board tools' tool results: one-line cardLine for the
// list, the multi-line thread transcript for read_thread, and the human label the permission
// prompt reads. lib/board-tools.ts wires these into the MCP tools.

import { asText, clip, firstLine, shortToolName } from "./format";
import { getCard, getThread } from "./store";
import type { Card, ThreadItem } from "./types";

function boardCard(id: string): Card {
  const card = getCard(id);
  if (!card || card.role === "copilot") throw new Error(`No card ${id}. Use list_cards to get card ids.`);
  return card;
}

export { boardCard };

export function describeCard(card: Card) {
  return [
    `id: ${card.id}`,
    `title: ${card.title}`,
    `column: ${card.column}`,
    `cli: ${card.backend}`,
    `folder: ${card.cwd}`,
    card.stage && `stage: ${card.stage}`,
    card.remaining && `remaining: ${card.remaining}`,
    card.lastLine && `latest: ${card.lastLine}`,
    card.pending && `waiting on the user for: ${card.pending.title}`,
    card.error && `error: ${card.error}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// A worker's synced thread can hold a sealed item (no key here) or a kind this list doesn't draw: those are left out.
export function threadText(items: ThreadItem[]) {
  return items
    .map((item) => {
      switch (item.kind) {
        case "user":
          return `USER: ${item.text}`;
        case "assistant":
          return `AGENT: ${item.text}`;
        case "tool":
          return `TOOL ${shortToolName(item.name)} ${item.summary}${item.isError ? " (failed)" : ""}`;
        case "permission":
          return `PERMISSION ${item.title}: ${item.decision ?? "waiting"}`;
        case "result":
          return item.isError ? `TURN ENDED: ${item.text}` : "TURN FINISHED";
        case "notification":
          return `TASK NOTIFICATION: ${item.summary}`;
        case "shell":
          return `USER RAN: ! ${item.command}${item.exitCode ? ` (exit ${item.exitCode})` : ""}`;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

// A readable permission prompt for the board tools that need the user's OK.
export function describeBoardTool(toolName: string, input: Record<string, unknown>): string | null {
  const name = toolName.replace(/^mcp__board__/, "");
  const card = typeof input.card_id === "string" ? getCard(input.card_id) : undefined;
  const label = card ? `“${card.title}”` : asText(input.card_id, "a card");
  switch (name) {
    case "start_card":
      return `Start ${label}`;
    case "send_message":
      return `Reply to ${label}: ${clip(asText(input.text), 140)}`;
    case "answer_permission":
      return `${input.allow ? "Allow" : "Deny"} ${card?.pending?.title ?? "its request"} on ${label}`;
    case "restart_weft_when_idle":
      return "Restart Weft once the running threads finish";
    default:
      return null;
  }
}

// One line per card, so a whole board fits in a tool result (the full detail is read_thread's).
export function cardLine(card: Card) {
  return [
    card.id,
    card.column,
    `${card.starred ? "★ " : ""}${clip(card.title, 80)}`,
    card.cwd.replace(/^\/Users\/[^/]+/, "~"),
    card.tags?.length && `tags: ${card.tags.join(", ")}`,
    card.stage,
    card.remaining && `remaining: ${clip(card.remaining, 60)}`,
    card.pending && `waiting on: ${clip(card.pending.title, 60)}`,
    card.error && `error: ${firstLine(card.error, 60)}`,
    card.lastLine && `latest: ${firstLine(card.lastLine, 80)}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

// The full card text read_thread returns, shared by both board servers.
export function readThreadText(cardId: string, last?: number): string {
  const card = boardCard(cardId);
  const items = getThread(card.id).filter(Boolean).slice(-(last ?? 30));
  return `${describeCard(card)}\n\n---\n\n${threadText(items) || "(empty thread)"}`;
}

export const LIST_LIMIT = 40;

export interface ListOptions {
  column?: Card["column"];
  include_done?: boolean;
  limit?: number;
}

// list_cards' answer for a set of cards: the open ones (or all), newest first, with notes on what was left out. The
// cards are this Mac's store, or on a worker the user's board (lib/worker-board-tools.ts).
export function listText(cards: Card[], { column, include_done = false, limit = LIST_LIMIT }: ListOptions): string {
  const all = cards.filter((c) => c.role !== "copilot" && (!column || c.column === column));
  const shown = all.filter((c) => include_done || (c.column !== "done" && !c.archived)).sort((a, b) => b.updatedAt - a.updatedAt);
  const hidden = all.length - shown.length;
  const notes = [
    shown.length > limit && `${shown.length - limit} more not shown; raise limit or pass column.`,
    hidden > 0 && `${hidden} done or archived left out; pass include_done=true to list them.`,
  ].filter(Boolean);
  if (!shown.length) notes.unshift(`No ${hidden ? "open " : ""}cards${column ? ` in ${column}` : ""}.`);
  return [...shown.slice(0, limit).map(cardLine), ...notes].join("\n");
}

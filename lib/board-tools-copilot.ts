// The copilot's tools on one card (lib/board-tools.ts boardMcpServer): read its thread, tag, start, reply, move, stop and
// answer it. A card on this Mac runs through the runner's BoardActions and the store; a card on one of the user's Weft
// Workers goes to that worker as the host verb the board's own hostOf(card).act sends (lib/board-tools-hosts.ts), never
// this Mac's store. The user approves start, reply and answer either way (SAFE_BOARD_TOOLS leaves them out).
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { firstMessage } from "./automations";
import { actOnHostCard, findHostCard, hostThreadText } from "./board-tools-hosts";
import { markSeen } from "./copilot-digest";
import { phoneOnlyAllow } from "./passkey-phone-only";
import { updateCard } from "./store";
import { rememberTags } from "./tag-store";
import { normalizeTags } from "./tags";
import type { Card } from "./types";
import type { WorkerReach } from "./worker-board-reach";

// What the board tools need from the runner, passed in to avoid a circular import.
export interface BoardActions {
  start(cardId: string, text: string): void;
  stop(cardId: string): Promise<void>;
  answer(cardId: string, allow: boolean, answers?: Record<string, string>): void;
  isBusy(cardId: string): boolean;
}

// What the copilot is told when it tries to Allow a phone-only ask for the user.
export const COPILOT_PHONE_ONLY = "That one needs the user's Touch ID: it reaches a vault secret, skips permissions or changes an agent's settings. Ask them to Allow it on the card.";

type Reply = { content: { type: "text"; text: string }[]; isError?: true };

export async function attempt(run: () => string | Promise<string>): Promise<Reply> {
  try {
    return { content: [{ type: "text", text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

// Tags a thread or the copilot set count as the user's, so retitle leaves them alone; new ones join the catalog.
export function tagsPatch(raw: string[] = []): Pick<Card, "tags" | "tagsBy"> {
  const tags = normalizeTags(raw);
  if (!tags.length) return {};
  rememberTags(tags);
  return { tags, tagsBy: "user" };
}

// read_thread, on whichever host holds the card.
export function readThreadTool(reach: WorkerReach) {
  return tool(
    "read_thread",
    "Read a thread's conversation: user messages, agent replies, tool calls, and permission requests.",
    { card_id: z.string(), last: z.number().int().positive().optional().describe("Only the last N entries (default 30)") },
    ({ card_id, last }) => attempt(() => hostThreadText(card_id, last, reach)),
  );
}

// The copilot's tools that act on one card, on whichever host holds it.
export function copilotCardTools(actions: BoardActions, reach: WorkerReach) {
  // A local card runs `here`; a worker's sends `verb` to its worker. Either answers the reply's text.
  const onCard = (id: string, here: (card: Card) => string | Promise<string>, there: (card: Card) => Promise<string>) =>
    attempt(async () => {
      const { card, worker } = await findHostCard(id, reach);
      return worker ? there(card) : here(card);
    });
  const sent = async (card: Card, verb: Parameters<typeof actOnHostCard>[1], args: Record<string, unknown>, done: string) =>
    `${done}${await actOnHostCard(card, verb, args, reach)}`;
  return [
    tool(
      "set_tags",
      "Replace a card's tags (an empty list clears them). Tags are short lowercase labels, like GitHub's.",
      { card_id: z.string(), tags: z.array(z.string()) },
      ({ card_id, tags }) => {
        const said = (card: Card, patch: Pick<Card, "tags">) => (patch.tags ? `Tagged “${card.title}”: ${patch.tags.join(", ")}.` : `Cleared “${card.title}”'s tags.`);
        return onCard(
          card_id,
          (card) => {
            const patch = tagsPatch(tags);
            updateCard(card.id, { tags: patch.tags ?? [], tagsBy: "user" });
            return said(card, patch);
          },
          (card) => {
            const patch = tagsPatch(tags);
            return sent(card, "card.update", { body: { tags: patch.tags ?? [] } }, said(card, patch));
          },
        );
      },
    ),
    tool("start_card", "Start a Backlog card running its prompt.", { card_id: z.string() }, ({ card_id }) => {
      const backlog = (card: Card) => {
        if (card.column !== "backlog") throw new Error(`“${card.title}” is in ${card.column}, not Backlog. Use send_message to continue it.`);
        return `Started “${card.title}”.`;
      };
      return onCard(
        card_id,
        (card) => {
          const done = backlog(card);
          actions.start(card.id, firstMessage(card));
          return done;
        },
        (card) => sent(card, "card.message", { text: firstMessage(card) }, backlog(card)),
      );
    }),
    tool(
      "send_message",
      "Reply to a thread that isn't running. It continues the same session with your message.",
      { card_id: z.string(), text: z.string() },
      ({ card_id, text }) =>
        onCard(
          card_id,
          (card) => {
            actions.start(card.id, text);
            return `Sent to “${card.title}”.`;
          },
          (card) => sent(card, "card.message", { text }, `Sent to “${card.title}”.`),
        ),
    ),
    tool(
      "move_card",
      "Move a card to Backlog, Review, or Done. Running and Needs you follow the thread itself. Unlike the user's own moves, this doesn't run the board's automations; to run a skill on a card, send_message it /<skill> (for example /weft:done).",
      { card_id: z.string(), column: z.enum(["backlog", "review", "done"]) },
      ({ card_id, column }) => {
        const moved = (card: Card, busy: boolean) => {
          if (busy) throw new Error(`“${card.title}” is running. Stop it first.`);
          markSeen(card.id, column);
          return `Moved “${card.title}” to ${column}.`;
        };
        return onCard(
          card_id,
          (card) => {
            const done = moved(card, actions.isBusy(card.id));
            updateCard(card.id, { column });
            return done;
          },
          (card) => sent(card, "card.update", { body: { column } }, moved(card, card.column === "running")),
        );
      },
    ),
    tool("stop_card", "Stop a running thread's current turn.", { card_id: z.string() }, ({ card_id }) =>
      onCard(
        card_id,
        async (card) => {
          await actions.stop(card.id);
          return `Stopped “${card.title}”.`;
        },
        (card) => sent(card, "card.stop", {}, `Stopped “${card.title}”.`),
      ),
    ),
    tool(
      "answer_permission",
      "Allow or deny the permission request a thread is waiting on, or answer the question it asked (pass answer). Only do this when the user has told you to.",
      { card_id: z.string(), allow: z.boolean(), answer: z.string().optional().describe("Your answer, when the thread asked a question") },
      ({ card_id, allow, answer }) => {
        const answersFor = (card: Card) => {
          const questions = card.pending?.questions;
          return questions && answer ? Object.fromEntries(questions.map((q) => [q.question, answer])) : undefined;
        };
        const said = (card: Card) => `${allow ? "Allowed" : "Denied"} on “${card.title}”.`;
        return onCard(
          card_id,
          (card) => {
            // A phone-only ask takes the user's Touch ID on the card (lib/local-approve.ts), never the copilot's word. On a
            // worker card the Allow goes unsigned, and a worker that pins a Mac refuses it (lib/worker-approve.ts).
            if (phoneOnlyAllow(card.pending, allow)) throw new Error(COPILOT_PHONE_ONLY);
            actions.answer(card.id, allow, answersFor(card));
            return said(card);
          },
          (card) => {
            if (!card.pending) throw new Error(`“${card.title}” isn't waiting on an answer.`);
            const answers = answersFor(card);
            return sent(card, "card.permission.answer", { allow, pendingId: card.pending.id, ...(answers ? { answers } : {}) }, said(card));
          },
        );
      },
    ),
  ];
}

// A reply to the card: sent, ↑ edited, or restarted.
import { sendToCopilot } from "@/lib/copilot";
import { restartTurn } from "@/lib/restart";
import { editLastMessage, sendUserMessage } from "@/lib/runner";
import { getCard } from "@/lib/store";
import { COPILOT_ID, type Card } from "@/lib/types";
import type { MessageArgs } from "./calls";
import { settle } from "./types";

type CardReply = { card: Card | undefined };

function written(text: string | undefined): string {
  if (!text?.trim()) throw new Error("Write a message first.");
  return text.trim();
}

export function sendMessageVerb({ id, text }: MessageArgs): Promise<CardReply> {
  return settle(() => {
    const message = written(text);
    if (id === COPILOT_ID) sendToCopilot(message);
    else sendUserMessage(id, message);
    return { card: getCard(id) };
  });
}

// ↑ in the reply box: replaces your last message and the turn it started.
export async function editMessageVerb({ id, text }: MessageArgs): Promise<CardReply> {
  await editLastMessage(id, written(text));
  return { card: getCard(id) };
}

// A stopped card's Restart button: your last message again in a fresh CLI.
export async function restartVerb({ id }: { id: string }): Promise<CardReply> {
  await restartTurn(id);
  return { card: getCard(id) };
}

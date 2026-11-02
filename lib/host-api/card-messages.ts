// A reply to the card: sent, ↑ edited, or restarted.
import { restartTurn } from "../restart";
import { editLastMessage, sendUserMessage } from "../runner";
import { getCard } from "../store";
import { COPILOT_ID, type Card } from "../types";
import type { MessageArgs } from "./calls";

type CardReply = { card: Card | undefined };

function written(text: string | undefined): string {
  if (!text?.trim()) throw new Error("Write a message first.");
  return text.trim();
}

// The copilot loads only when it is the one written to: it lives on the desktop, and a worker's daemon can't load it.
export async function sendMessageVerb({ id, text }: MessageArgs): Promise<CardReply> {
  const message = written(text);
  if (id === COPILOT_ID) (await import("../copilot")).sendToCopilot(message);
  else sendUserMessage(id, message);
  return { card: getCard(id) };
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

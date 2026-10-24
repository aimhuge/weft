// The feedback you typed on a review step, kept until it's sent. Each step has its own slot, so
// stepping through a tour doesn't overwrite what you wrote on an earlier step — but a slot you
// step away from must not vanish either: it's still there, and these helpers are how the panel
// finds it again and sends it.

import { readDraft, writeDraft } from "./drafts";

// Where a step's unsent feedback lives.
export const feedbackKey = (cardId: string, step: number) => `weft.review.${cardId}.${step}`;

// The steps that still hold feedback you haven't sent, in tour order.
export function unsentSteps(cardId: string, steps: number[]): number[] {
  return steps.filter((step) => readDraft(feedbackKey(cardId, step)).trim().length > 0);
}

// How many steps still hold unsent feedback.
export function unsentCount(cardId: string, steps: number[]): number {
  return unsentSteps(cardId, steps).length;
}

// The feedback for a step, as it reads in a message: which step it was on and what it said. The one
// place that wording lives, so the single-step send and the flush can never disagree about it.
export function feedbackMessage(
  cardId: string,
  step: number,
  title: string,
  total: number,
): string | undefined {
  const text = readDraft(feedbackKey(cardId, step)).trim();
  if (!text) return undefined;
  return `Review feedback on step ${step + 1} of ${total}, “${title}”:\n${text}`;
}

// Every step's unsent feedback, as one message, so the thread can act on all of it at once. Steps
// with nothing written are left out.
export function collectFeedback(
  cardId: string,
  steps: { title: string }[],
): string | undefined {
  const parts: string[] = [];
  for (const [index, step] of steps.entries()) {
    const message = feedbackMessage(cardId, index, step.title, steps.length);
    if (message) parts.push(message);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

// Forgets a step's feedback, once it's been sent.
export function clearFeedback(cardId: string, step: number) {
  writeDraft(feedbackKey(cardId, step), "");
}

// Saves what you typed on a step, so it's still there when you come back to it.
export function writeFeedback(cardId: string, step: number, markdown: string) {
  writeDraft(feedbackKey(cardId, step), markdown);
}

// Forgets every step's feedback, once it's all been sent.
export function clearAllFeedback(cardId: string, steps: number[]) {
  for (const step of steps) clearFeedback(cardId, step);
}

// Sends one step's feedback to the thread and forgets it. The step number it names and the slot it
// clears are the same one, so the thread is never told about a different step than the one that was
// sent. Throws if the send fails, and then the draft stays: a note is never lost to a failed send.
export async function sendStepFeedback(
  cardId: string,
  step: number,
  title: string,
  total: number,
  send: (text: string) => Promise<void>,
): Promise<void> {
  const message = feedbackMessage(cardId, step, title, total);
  if (!message) return;
  await send(message);
  clearFeedback(cardId, step);
}

// Sends every step's unsent feedback in one message, and forgets it. Returns how many steps had
// something to say, so the caller knows whether anything went out. Feedback you wrote for the thread
// to act on goes out with the approval, rather than staying behind on a step you stepped away from.
export async function flushFeedback(
  cardId: string,
  steps: { title: string }[],
  send: (text: string) => Promise<void>,
): Promise<number> {
  const parts: string[] = [];
  for (const [index, step] of steps.entries()) {
    const message = feedbackMessage(cardId, index, step.title, steps.length);
    if (message) parts.push(message);
  }
  if (!parts.length) return 0;
  await send(parts.join("\n\n"));
  clearAllFeedback(cardId, steps.map((_, i) => i));
  return parts.length;
}

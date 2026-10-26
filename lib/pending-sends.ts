import type { ThreadPage } from "./thread-page";
import type { ThreadItem } from "./types";

// A message you sent from the reply box that the server's thread doesn't show yet. The box clears the moment you
// press Enter and the message is drawn in the thread at once (components/ThreadView.tsx), instead of both waiting
// for the server's "thread" event, which made a send look like it did nothing.
// from: the thread index its own user item will land at or after (the thread's length as it was sent, or for an
// edit the index after the message it replaces, lib/edit-last.ts).
export type PendingSend = { key: number; text: string; from: number; at: number };

// The pending sends the page doesn't show yet. Each user item at or after a send's `from` stands for the oldest
// send still waiting there: the server may reword a message (a "!" command's output goes along with it), so
// texts aren't compared.
export function unsent(page: ThreadPage, pending: PendingSend[]): PendingSend[] {
  if (!pending.length) return pending;
  const waiting = [...pending].sort((a, b) => a.key - b.key);
  // A live event can land past the loaded window, leaving holes in it.
  (page.items as (ThreadItem | undefined)[]).forEach((item, i) => {
    if (item?.kind !== "user") return;
    const at = waiting.findIndex((p) => p.from <= page.start + i);
    if (at !== -1) waiting.splice(at, 1);
  });
  return waiting;
}

// How a pending send is drawn: a user message like any other.
export const pendingItem = (p: PendingSend): ThreadItem => ({ kind: "user", text: p.text, at: p.at });

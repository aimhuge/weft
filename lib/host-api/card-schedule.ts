// Send later: a message held on the card until its time, and taken back. The host that runs the card holds the timer
// (lib/scheduler.ts sendDueMessages, on this Mac's server and on a worker's daemon alike), and the message is saved on
// the card, so it survives the host restarting. What it sends is a plain reply when its time comes (sendUserMessage),
// never a "!" shell command: lib/host-command.ts remoteRefusal turns one away from the network before it gets here.
import { scheduleMessage, unscheduleMessage } from "../scheduler";
import type { Card } from "../types";
import { settle } from "./types";

type CardReply = { card: Card };

export type ScheduleArgs = { id: string; text?: string; at?: unknown };
export type UnscheduleArgs = { id: string; messageId?: string };

export function scheduleVerb({ id, text, at }: ScheduleArgs): Promise<CardReply> {
  return settle(() => {
    if (!text?.trim()) throw new Error("Write a message first.");
    return { card: scheduleMessage(id, text.trim(), Number(at)) };
  });
}

export function unscheduleVerb({ id, messageId }: UnscheduleArgs): Promise<CardReply> {
  return settle(() => {
    if (!messageId) throw new Error("Which message?");
    return { card: unscheduleMessage(id, messageId) };
  });
}

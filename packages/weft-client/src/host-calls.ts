// What a route's body asks for, without loading any handler: the card.update body and whether it widens the
// thread's power, and which messages or permission verb a body names. Kept apart from the handlers so a route
// (or, next, the worker daemon) can pick a verb before HOST_API loads the module that runs it. lib/host-api/calls.ts
// re-exports it.
import type { Column, PermissionMode } from "./card";

export type CardPatch = {
  column?: Column;
  title?: unknown;
  cwd?: string;
  archived?: unknown;
  starred?: unknown;
  tags?: unknown;
  broke?: null;
  permissionMode?: PermissionMode;
  agent?: unknown;
  // The user clicked "Read from <path>" on a question. The directory is added to the card's
  // read scope (Card.readScope) so the live session's folder guard allows it
  // and the next session starts with it as additionalDirectories.
  readScope?: unknown;
  // The backlog's drop-onto-card gesture: place this card before `before` (a sibling id)
  // in the card's own column, or at the end when null.
  before?: string | null;
};

export type CardUpdateArgs = { id: string; body: CardPatch };

// A mode change or a read grant widens what the thread may do: only Weft's own window, not a thread's curl (lib/guard.ts).
export function widens(body: CardPatch): boolean {
  return body.permissionMode !== undefined || body.readScope !== undefined;
}

export type MessageBody = { text?: string; edit?: boolean; restart?: boolean };
export type MessageArgs = { id: string; text?: string };

/** Which messages verb a reply body names: restart first, then edit, else a plain send. */
export function messageCall(id: string, body: MessageBody): { verb: "card.message" | "card.message.edit" | "card.restart"; args: MessageArgs } {
  const { text, edit, restart } = body;
  if (restart) return { verb: "card.restart", args: { id } };
  return { verb: edit ? "card.message.edit" : "card.message", args: { id, text } };
}

export type PermissionBody = {
  allow?: boolean;
  // Wait: hold the edit until the card holding that code lets go (lib/permission-wait.ts).
  wait?: boolean;
  // This first: go ahead, and the card holding that code yields the file (lib/precedence.ts).
  first?: boolean;
  // Others first: the card holding that code goes ahead, and this card waits for it (lib/precedence.ts).
  otherFirst?: boolean;
  answers?: Record<string, string>;
  pendingId?: string;
  annotations?: unknown;
  chat?: unknown;
};

export type Pending = { id: string; pendingId: unknown };
export type AnswerArgs = { id: string; allow?: boolean; answers?: unknown; pendingId?: unknown; annotations?: unknown; chat?: unknown };

type PermissionCall =
  | { verb: "card.permission.first" | "card.permission.otherFirst" | "card.permission.wait"; args: Pending }
  | { verb: "card.permission.answer"; args: AnswerArgs };

/** Which permission verb a body names: This first, then Others first, then Wait, else an answer. */
export function permissionCall(id: string, body: PermissionBody): PermissionCall {
  const { allow, answers, pendingId } = body;
  if (body.first === true) return { verb: "card.permission.first", args: { id, pendingId } };
  if (body.otherFirst === true) return { verb: "card.permission.otherFirst", args: { id, pendingId } };
  if (body.wait === true) return { verb: "card.permission.wait", args: { id, pendingId } };
  return { verb: "card.permission.answer", args: { id, allow, answers, pendingId, annotations: body.annotations, chat: body.chat } };
}

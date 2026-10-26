// The reply a Goose turn is streaming (docs/architecture/goose.md).
//
// Goose 1.x sends one reply as many message lines that share an id, a few words each. They are gathered here
// and filed as one row when the reply is over: the next reply, a tool step, an error or the end of the turn.
// The latest reply filed is kept too, because it is the text the turn's result carries.
import type { Session } from "./runner-state";

interface Reply {
  id: string;
  text: string;
  last: string;
}

/** How a finished reply reaches the thread: lib/goose-runner.ts files it as an assistant row. */
export type FileReply = (text: string) => Promise<void>;

const replies = new WeakMap<Session, Reply>();

function replyOf(session: Session): Reply {
  let reply = replies.get(session);
  if (!reply) {
    reply = { id: "", text: "", last: "" };
    replies.set(session, reply);
  }
  return reply;
}

/** Forgets the last turn's reply, at the start of a new one. */
export function resetReply(session: Session) {
  replies.delete(session);
}

/** The latest reply filed this turn, or "". */
export function lastReply(session: Session): string {
  return replyOf(session).last;
}

/** Files the reply gathered so far as one row in the thread. */
export async function flushReply(session: Session, file: FileReply) {
  const reply = replyOf(session);
  if (!reply.text) return;
  const text = reply.text;
  reply.text = "";
  reply.id = "";
  reply.last = text;
  await file(text);
}

/** A message event: a slice of the reply being streamed, or (from an older Goose with no id) a whole one. */
export async function addToReply(session: Session, text: string, id: string | undefined, file: FileReply) {
  if (!id) {
    await flushReply(session, file);
    replyOf(session).last = text;
    await file(text);
    return;
  }
  const reply = replyOf(session);
  if (reply.id && reply.id !== id) await flushReply(session, file);
  reply.id = id;
  reply.text += text;
}

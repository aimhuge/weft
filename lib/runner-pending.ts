import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { safeUpdate, sessions, type Pending } from "./runner-state";
import { elicitationContent } from "./elicitation";
import { replaceThreadItem } from "./store";
import type { QuestionReply } from "./types";

// A pending permission request and how it is answered. Lives on its own so lib/runner-ask.ts (which
// asks) and lib/permission-wait.ts (which holds a request until another card lets go of the code)
// can both use it without importing each other.

// pendingId ties the answer to the request the user saw; without it, the oldest one is answered.
// reply carries a question's notes, or the message that declines it to talk it over instead.
export function answerPermission(
  cardId: string,
  allow: boolean,
  answers?: Record<string, string>,
  pendingId?: string,
  reply?: QuestionReply,
) {
  const queue = sessions.get(cardId)?.pending ?? [];
  const target = pendingId ? queue.find((p) => p.id === pendingId) : queue[0];
  if (!target) throw new Error(pendingId ? "That request isn't waiting anymore." : "Nothing is waiting for an answer.");
  if (target.questions && allow && !answers) throw new Error("This thread asked a question, so it needs answers.");
  // A form that doesn't fit its schema throws here, so the board says why and you can answer again.
  if (target.elicitation && allow) elicitationContent(target.elicitation.fields, answers);
  settle(cardId, allow, answers, target.id, reply);
}

// denyMessage: what a denial tells the thread instead of "The user denied this" (a Wait that ended, lib/permission-wait.ts).
export function settle(
  cardId: string,
  allow: boolean,
  answers?: Record<string, string>,
  pendingId?: string,
  reply?: QuestionReply,
  denyMessage?: string,
) {
  const session = sessions.get(cardId);
  if (!session) return false;
  const at = pendingId ? session.pending.findIndex((p) => p.id === pendingId) : 0;
  const p = at >= 0 ? session.pending[at] : undefined;
  if (!p) return false;
  session.pending.splice(at, 1);
  replaceThreadItem(cardId, p.index, {
    kind: "permission",
    id: p.id,
    toolName: p.toolName,
    title: p.title,
    decision: allow ? "allow" : "deny",
    answer: answers ? Object.values(answers).join("; ") : undefined,
    at: Date.now(),
  });
  const next = session.pending[0];
  safeUpdate(cardId, {
    column: next ? "needs_you" : "running",
    pending: next ? pendingView(next) : null,
    lastLine: next ? next.title : answers ? `Answered: ${Object.values(answers).join("; ")}` : `${allow ? "Allowed" : "Denied"}: ${p.title}`,
  });
  p.resolve(denyMessage && !allow ? { behavior: "deny", message: denyMessage } : permissionResult(p, allow, answers, reply));
  return true;
}

// What the CLI gets back: the input (with the answers and any notes, for a question), or a denial, which
// for a question carries what the user wrote instead of answering.
function permissionResult(p: Pending, allow: boolean, answers?: Record<string, string>, reply?: QuestionReply): PermissionResult {
  if (p.questions) {
    if (allow && answers) {
      const annotations = reply?.annotations && Object.keys(reply.annotations).length ? { annotations: reply.annotations } : {};
      return { behavior: "allow", updatedInput: { ...p.input, answers, ...annotations } };
    }
    const chat = reply?.chat?.trim();
    return {
      behavior: "deny",
      message: chat
        ? `The user didn't pick an answer and wants to talk it over instead. They wrote: ${chat}`
        : "The user skipped the question.",
    };
  }
  // An MCP server's form: its values ride along for lib/elicitation.ts elicitationResult.
  if (p.elicitation && allow) return { behavior: "allow", updatedInput: { ...p.input, ...(answers ? { answers } : {}) } };
  return allow ? { behavior: "allow", updatedInput: p.input } : { behavior: "deny", message: "The user denied this in Weft." };
}

export function pendingView(p: Pending) {
  return { id: p.id, toolName: p.toolName, title: p.title, input: p.input, questions: p.questions, readScope: p.readScope, previewUrl: p.previewUrl, edit: p.edit, why: p.why, waiting: p.waiting, elicitation: p.elicitation };
}

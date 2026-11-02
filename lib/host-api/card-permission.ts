// The answers to a card's permission prompt or question: allow or deny (with a question's answers), Wait,
// This first and Others first.
import { putFirst, putHolderFirst } from "../precedence";
import { readQuestionReply } from "../question-reply";
import { answerPermission, waitPermission } from "../runner";
import type { AnswerArgs, Pending } from "./calls";
import { OK, settle, type Ok } from "./types";

function pendingIdFor(pendingId: unknown, what: string): string {
  if (typeof pendingId !== "string") throw new Error(`${what} needs the request's pendingId.`);
  return pendingId;
}

export function putFirstVerb({ id, pendingId }: Pending): Promise<Ok> {
  return settle(() => {
    putFirst(id, pendingIdFor(pendingId, "This first"));
    return OK;
  });
}

export function putOtherFirstVerb({ id, pendingId }: Pending): Promise<Ok> {
  return settle(() => {
    putHolderFirst(id, pendingIdFor(pendingId, "Others first"));
    return OK;
  });
}

export function waitVerb({ id, pendingId }: Pending): Promise<Ok> {
  return settle(() => {
    waitPermission(id, pendingIdFor(pendingId, "Wait"));
    return OK;
  });
}

export function answerVerb({ id, allow, answers, pendingId, annotations, chat }: AnswerArgs): Promise<Ok> {
  return settle(() => {
    answerPermission(
      id,
      allow === true,
      answers && typeof answers === "object" ? (answers as Record<string, string>) : undefined,
      typeof pendingId === "string" ? pendingId : undefined,
      readQuestionReply({ annotations, chat }),
    );
    return OK;
  });
}

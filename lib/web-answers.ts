// Allow and Deny on the weft.zip board, drawn at once. The answer goes to the Mac (or Worker) running the card as
// a cloud command (lib/cloud-commands.ts answerCommand), so the synced card still shows the prompt until that
// machine has run it and its outbox has sent the card back: seconds. Like the desktop's answerNow
// (lib/optimistic-cards.ts), the board draws the card answered meanwhile; a command that failed brings the prompt
// back, with its error under the reply box (WebReplyStatus).
import type { AnswerPayload, CloudCommandRow } from "./cloud-commands";
import type { CloudCardRow } from "./cloud-sync-types";

// One plain Allow or Deny the visitor sent from this page.
export interface WebAnswer {
  cardId: string;
  pendingId: string;
  allow: boolean;
}

const sameAnswer = (a: Pick<WebAnswer, "cardId" | "pendingId">, b: Pick<WebAnswer, "cardId" | "pendingId">) => a.cardId === b.cardId && a.pendingId === b.pendingId;

// The answer a command carries, when it is one.
export function commandAnswer(command: Pick<CloudCommandRow, "kind" | "payload">): AnswerPayload | null {
  return command.kind === "answer" ? (command.payload as AnswerPayload) : null;
}

// Whether an answer command for that prompt failed on the machine running the card.
function failed(answer: WebAnswer, commands: readonly CloudCommandRow[]): boolean {
  return commands.some((c) => {
    const sent = c.status === "failed" ? commandAnswer(c) : null;
    return sent !== null && sameAnswer(sent, answer);
  });
}

// The rows as the board draws them: a card whose prompt was answered here, and whose command hasn't failed, shows
// it answered (no prompt, back in Running, the answer as its last line) until its synced row moves past that prompt.
export function withAnswers(rows: CloudCardRow[], answers: readonly WebAnswer[], commands: readonly CloudCommandRow[]): CloudCardRow[] {
  if (!answers.length) return rows;
  return rows.map((row) => {
    const p = row.card.pending;
    const answer = p && answers.find((a) => sameAnswer(a, { cardId: row.card_id, pendingId: p.id }));
    if (!p || !answer || failed(answer, commands)) return row;
    const column = row.card.column === "needs_you" ? "running" : row.card.column;
    return { ...row, card: { ...row.card, column, pending: null, lastLine: `${answer.allow ? "Allowed" : "Denied"}: ${p.title}` } };
  });
}

// The answers left once a command is dropped (a failed one cleared from under the reply box): its prompt stays shown.
export function dropAnswer(answers: WebAnswer[], command: Pick<CloudCommandRow, "kind" | "payload"> | undefined): WebAnswer[] {
  const dropped = command && commandAnswer(command);
  return dropped ? answers.filter((a) => !sameAnswer(a, dropped)) : answers;
}

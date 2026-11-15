// The attachments the user pasted into an answer to a card's question: an image dropped into the "Type something"
// box arrives as `![pasted-image.png](~/.weft/attachments/x.webp)` inside the answer, and the secret guard only let a
// card open what its user messages named, so the card that asked couldn't look at it (2026-11-16). settle()
// stores these names on the thread's permission item, where lib/secret-guard-pasted.ts reads them.
//
// Only what the user wrote counts: a name the question's own options carry (the model wrote those) is left out,
// so a thread can't word an option to open another card's attachment by getting it picked.

import { MEDIA_REF, attachmentName } from "./media";
import type { Question, QuestionReply } from "./types-thread";

function namesIn(text: string | undefined): string[] {
  if (!text) return [];
  const names: string[] = [];
  for (const m of text.matchAll(MEDIA_REF)) {
    const name = attachmentName((m[2] ?? m[3]) as string);
    if (name) names.push(name);
  }
  return names;
}

export function answerPasted(questions: Question[] | undefined, answers?: Record<string, string>, reply?: QuestionReply): string[] {
  const offered = new Set((questions ?? []).flatMap((q) => q.options.flatMap((o) => [...namesIn(o.label), ...namesIn(o.description)])));
  const written = [
    ...Object.values(answers ?? {}),
    ...Object.values(reply?.annotations ?? {}).map((a) => a.notes),
    reply?.chat,
  ].flatMap(namesIn);
  return [...new Set(written)].filter((name) => !offered.has(name));
}

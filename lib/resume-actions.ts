import { resumeAllTargets, type ResumeHow } from "./card-resume";
import { api } from "./client";
import { patchNow } from "./optimistic-cards";
import type { Card } from "./types";

// The board's resume buttons: a card's ▶ and Restart, and Resume all over the Review cards on screen. Failures go to
// `notify` (the board's toast).
export function resumeActions(review: Card[], notify: (err: unknown) => void) {
  // The card moves to Running the moment you click (lib/optimistic-cards.ts), so ▶ never looks ignored.
  const resume = (id: string, how: ResumeHow) => {
    patchNow(id, { column: "running" }, () => (how === "continue" ? api.send(id, "continue") : api.restart(id))).catch(notify);
  };
  const targets = resumeAllTargets(review);
  const all = targets.length ? { count: targets.length, run: () => targets.forEach((t) => resume(t.id, t.how)) } : undefined;
  return { resume, all };
}

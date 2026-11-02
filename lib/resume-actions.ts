import { resumeAllTargets, type ResumeHow } from "./card-resume";
import { api } from "./client";
import { patchNow } from "./optimistic-cards";
import { hostFor } from "./project-host";
import type { Card } from "./types";

// The board's resume buttons: a card's ▶ and Restart, and Resume all over the Review cards on screen, a worker's among
// them (each on its own host, lib/project-host.ts; this Mac's through the calls it has always made). Failures go to
// `notify` (the board's toast).
export function resumeActions(review: Card[], notify: (err: unknown) => void) {
  // The card moves to Running the moment you click (lib/optimistic-cards.ts), so ▶ never looks ignored.
  const resume = (id: string, how: ResumeHow) => {
    const host = hostFor(review.find((c) => c.id === id)?.cwd);
    const go = () => (how === "continue" ? host.act("card.message", { id, text: "continue" }, () => api.send(id, "continue")) : host.act("card.restart", { id }, () => api.restart(id)));
    patchNow(id, { column: "running" }, go).catch(notify);
  };
  const targets = resumeAllTargets(review);
  const all = targets.length ? { count: targets.length, run: () => targets.forEach((t) => resume(t.id, t.how)) } : undefined;
  return { resume, all };
}

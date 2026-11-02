// A board card's own controls on whichever host runs it (docs/architecture/project-hosts.md). This Mac's cards keep
// their handlers (lib/card-handlers.ts); a card on another host (a Weft Worker) gets the same set, each sent as a host-api
// verb through lib/project-host.ts and drawn at once (lib/optimistic-cards.ts), so the tile works the same. The board
// asks handlersFor and never whether a card is a worker's.
import type React from "react";
import type { ResumeHow } from "./card-resume";
import { cardHandlers, type CardActionsCtx } from "./card-handlers";
import { answerNow, firstNow, otherFirstNow, patchNow, removeNow, stopNow, waitNow } from "./optimistic-cards";
import { hostOf } from "./project-host";
import type { Card } from "./types";

// The tile's handlers for a card on another host: the same props cardHandlers gives, over its host's verbs.
export function remoteCardHandlers(card: Card, ctx: CardActionsCtx): ReturnType<typeof cardHandlers> {
  const host = hostOf(card);
  const id = card.id;
  return {
    onOpen: () => ctx.openCard(card),
    onAnswer: (allow: boolean) => {
      const pendingId = card.pending?.id;
      if (pendingId) void answerNow(id, pendingId, allow, () => host.act("card.permission.answer", { id, allow, pendingId })).catch(ctx.notify);
    },
    onStop: () => void stopNow(id, () => host.act("card.stop", { id })).catch(ctx.notify),
    // ▶ sends "continue" into its session and Restart its last message again, as on this Mac (lib/resume-actions.ts).
    onResume: (how: ResumeHow) =>
      void patchNow(id, { column: "running" }, () => (how === "continue" ? host.act("card.message", { id, text: "continue" }) : host.act("card.restart", { id }))).catch(ctx.notify),
    onContextMenu: (e: React.MouseEvent) => void ctx.onCardMenu(card, e),
    onStar: () => ctx.toggleStar(card),
    onArchive: () => ctx.toggleArchive(card),
    onTag: ctx.onTag,
  };
}

// Delete a card on its host, gone from the board at once: this Mac's DELETE route, or card.delete on a worker.
export function removeOnHost(card: Pick<Card, "id" | "cwd">): Promise<void> {
  const host = hostOf(card);
  return removeNow(card.id, host.kind === "local" ? undefined : () => host.act("card.delete", { id: card.id }));
}

export function handlersFor(card: Card, ctx: CardActionsCtx): ReturnType<typeof cardHandlers> {
  return hostOf(card).kind === "local" ? cardHandlers(card, ctx) : remoteCardHandlers(card, ctx);
}

// The held-edit choices on a card's prompt (lib/precedence.ts, lib/permission-wait.ts), each asked of the card's host.
const HOLDS = {
  wait: { now: waitNow, verb: "card.permission.wait" },
  first: { now: firstNow, verb: "card.permission.first" },
  otherFirst: { now: otherFirstNow, verb: "card.permission.otherFirst" },
} as const;

export type Hold = keyof typeof HOLDS;

export function holdNow(card: Pick<Card, "id" | "cwd">, hold: Hold, pendingId: string): Promise<void> {
  const { now, verb } = HOLDS[hold];
  return now(card.id, pendingId, () => hostOf(card).act(verb, { id: card.id, pendingId }));
}

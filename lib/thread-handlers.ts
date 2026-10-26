import { api } from "./client";
import { answerNow, patchNow, removeNow } from "./optimistic-cards";
import type { Card, PermissionMode, QuestionReply } from "./types";

// What the open card's thread does with the server: send, answer, release, delete, rename, mode and the
// copilot's New chat, closed over the board's select and notify so Board.tsx spreads one object into
// ThreadPanel instead of listing every handler (the thread's twin of lib/card-handlers.ts).
export type ThreadActionsCtx = {
  select: (id: string | null) => void;
  notify: (err: unknown) => void;
};

// /done and its kin wrap the thread up on their own.
const WRAP_UP = /^\/(weft:)?done(-quick)?(\s|$)/;

export function threadHandlers(card: Card, ctx: ThreadActionsCtx) {
  const close = () => ctx.select(null);
  return {
    onSend: async (text: string) => {
      // The thread closes as a wrap-up is sent, so a failed send shows on the board instead.
      if (WRAP_UP.test(text.trim())) {
        close();
        api.send(card.id, text).catch(ctx.notify);
        return;
      }
      await api.send(card.id, text);
    },
    // A failure is shown and rethrown, so the question form re-enables. A plain Allow or Deny leaves the thread at
    // once (lib/optimistic-cards.ts); a form with answers waits, so one that doesn't fit stays filled in.
    onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply) => {
      const pendingId = card.pending?.id;
      const send = () => api.answer(card.id, allow, answers, pendingId, reply);
      const sent = pendingId && !answers && !reply ? answerNow(card.id, pendingId, allow, send) : send();
      return sent.catch((err: unknown) => {
        ctx.notify(err);
        throw err;
      });
    },
    onRelease: () => void api.release(card.id).catch(ctx.notify),
    onDelete: () => {
      close();
      removeNow(card.id).catch(ctx.notify);
    },
    // The thread is always closeable from its own X; the pane column's X closes the pane, not the card.
    onClose: close,
    // The first-message-error banner's Delete closes the thread so the open card id doesn't linger.
    onDeleted: close,
    onRename: (title: string) => void patchNow(card.id, { title }, () => api.rename(card.id, title)).catch(ctx.notify),
    onMode: (mode: PermissionMode) => void patchNow(card.id, { permissionMode: mode }, () => api.setMode(card.id, mode)).catch(ctx.notify),
    onNewChat: () => void api.resetCopilot().then(() => ctx.select(card.id)).catch(ctx.notify),
  };
}

// The board's way in: a hook, so the React compiler lets it take `select` (which writes a ref) during
// render, where a plain call would be flagged. No card open, no handlers.
export function useThreadHandlers(card: Card | null, ctx: ThreadActionsCtx) {
  return card ? threadHandlers(card, ctx) : null;
}

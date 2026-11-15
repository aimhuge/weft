"use client";

import type { GrantScope } from "@/lib/cloud-commands";
import { isLive } from "@/lib/format";
import { modelOn } from "@/lib/new-thread";
import { paneLiveLine } from "@/lib/pane-live-line";
import { toggleThread } from "@/lib/pane-rail-open";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card, QuestionReply, ThreadItem } from "@/lib/types";
import { useAnsweredPrompt } from "@/lib/use-answered-prompt";
import { useNow } from "@/lib/use-now";
import { useSimplePiece } from "@/lib/use-simple-piece";
import { guarded } from "./guarded";
import { DOT, LABEL } from "./ShowRailItems";
import { PermissionRequest } from "./ThreadFooter";
import { questionFor } from "./ThreadView";

// The same reply box as the thread panel's, in its own CrashGuard so a broken box leaves the page.
const ReplyBox = guarded(() => import("./ReplyBox"), { what: "reply box", className: "mx-3 my-2" });

export type PaneBottomProps = {
  card: Card;
  items: ThreadItem[];
  // The thread column is open beside the page (the live line's toggle says Hide thread).
  thread?: boolean;
  onSend: (text: string) => Promise<void>;
  onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope) => unknown;
};

// The open card's live line: the rail's dot for its newest turn, and its newest step or last sentence. It is also the
// thread's toggle, as on the phone, where the thread is one tap from the page.
function LiveLine({ card, items, thread }: { card: Card; items: ThreadItem[]; thread: boolean }) {
  const now = useNow();
  const line = paneLiveLine(items, { live: isLive(card), now });
  return (
    <button
      type="button"
      onClick={toggleThread}
      aria-expanded={thread}
      title={thread ? "Hide the thread" : "Show the thread"}
      className="flex min-w-0 items-center gap-2 px-3 py-2 text-left text-[12.5px] text-muted hover:text-ink"
      aria-live="polite"
    >
      {line && <span className={`size-[7px] shrink-0 rounded-full ${DOT[line.dot]}`} aria-label={LABEL[line.dot]} />}
      <span className="min-w-0 flex-1 truncate">{line?.text ?? "Open the thread"}</span>
      <span aria-hidden="true" className="shrink-0 text-faint">{thread ? "Hide thread" : "Thread ›"}</span>
    </button>
  );
}

// Under the full-page pane's page (docs/architecture/simple-mode.md, piece 1), the pane works like the phone's: a
// live line, the card's pending ask (a permission's Allow / Deny here; a question's options sit in the reply box, as in
// the thread panel) and the thread panel's own reply box with its mic, Stop and Send. Nothing here is new: the pieces
// are the thread panel's (components/ThreadFooter.tsx, components/ReplyBox.tsx) and send through the same handlers.
// It spans the whole card, under the thread too when that is open; the thread leaves its own reply box out
// (lib/reply-elsewhere.ts), so one card never has two.
export default function PaneBottom({ card, items, thread = false, onSend, onAnswer }: PaneBottomProps) {
  const transport = useThreadTransport();
  const { shell } = transport;
  const { answered, setAnsweredId } = useAnsweredPrompt(card.pending?.id);
  const live = isLive(card);
  // The full-page pane is simple mode's, and its box takes the phone's look and voice mode (components/Composer.tsx).
  const phone = useSimplePiece("pane-full");
  // As in components/ThreadView.tsx: one answer per prompt, and a refusal lets it be answered again.
  function answer(allow: boolean, answers?: Record<string, string>, grant?: GrantScope) {
    if (!card.pending || answered) return;
    setAnsweredId(card.pending.id);
    void Promise.resolve(onAnswer(allow, answers, undefined, grant)).catch(() => setAnsweredId(null));
  }
  return (
    <div data-pane-bottom className="flex max-h-[45%] shrink-0 flex-col overflow-y-auto border-t border-line bg-panel">
      <LiveLine card={card} items={items} thread={thread} />
      <PermissionRequest card={card} readOnly={false} answered={answered} answer={answer} />
      <ReplyBox
        key={card.id}
        cardId={card.id}
        cwd={card.cwd}
        live={live}
        midTurn={card.backend === "claude" || card.backend === "puku"}
        placeholder="Reply…"
        suggestion={card.suggestion}
        question={questionFor(card, onAnswer, transport)}
        fiveHour={card.stats?.fiveHour}
        backend={card.backend}
        model={modelOn(card.backend, card.model) ?? card.stats?.runsOn?.model}
        noPriorContext={!card.sessionId}
        noShell={shell ? undefined : transport.shellRefusal}
        onSend={onSend}
        onShell={shell && ((command) => shell(card.id, command))}
        onStop={() => transport.stop(card.id)}
        look={phone ? "phone" : undefined}
      />
    </div>
  );
}

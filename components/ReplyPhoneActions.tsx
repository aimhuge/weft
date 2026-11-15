"use client";

// The reply box's buttons in the phone look (docs/architecture/simple-mode.md, piece 1), as the phone draws them:
// Continue and Done as small words when the thread offers them, Stop ■ while the turn runs and a filled round Send ↑
// once there is something to send. Send does what Enter does (lib/reply-mode.ts: queue, after the next tool call,
// answer, run…); its tip says which. Every press goes back through onAction, as ReplyButtons' do.
import type { ReplyAction, ReplyModeView } from "@/lib/reply-mode";
import Icon, { Spinner } from "./Icon";
import Tip from "./Tip";

const WORD = "whitespace-nowrap rounded-full px-2 py-1 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";
const ROUND = "flex size-8 shrink-0 items-center justify-center rounded-full";

export default function ReplyPhoneActions({
  view,
  live,
  sending,
  empty,
  question,
  onAction,
  onStop,
}: {
  view: ReplyModeView;
  live: boolean;
  sending: boolean;
  // Nothing but whitespace in the box (lib/use-reply-draft.ts).
  empty: boolean;
  // A question waits for its answer, which Send gives even with an empty box.
  question: boolean;
  onAction: (action: ReplyAction) => void;
  onStop: () => void;
}) {
  // Send shows once there is something to send.
  const ready = !empty || question;
  // An empty box after a turn that stopped short: Enter would Continue, so the word shows instead of Send.
  const words = [view.cont, view.done, !ready && view.primary.action === "continue" ? view.primary : undefined];
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pl-1">
      {words.map(
        (w) =>
          w && (
            <Tip key={w.action} text={w.tip} className="inline-flex">
              <button type="button" onClick={() => onAction(w.action)} disabled={sending} className={WORD}>
                {w.label}
              </button>
            </Tip>
          ),
      )}
      {live && (
        <Tip text="Stop this turn" className="inline-flex">
          <button type="button" onClick={onStop} aria-label="Stop the current turn" className={`${ROUND} bg-ink text-canvas hover:opacity-90`}>
            <Icon name="stop" size={11} />
          </button>
        </Tip>
      )}
      {ready && (
        <Tip text={view.primary.tip} className="inline-flex">
          <button
            type="button"
            onClick={() => onAction(view.primary.action)}
            disabled={sending}
            aria-label={view.primary.label}
            className={`${ROUND} bg-accent text-on-accent hover:opacity-90 disabled:opacity-40`}
          >
            {sending ? <Spinner size={12} /> : <SendArrow />}
          </button>
        </Tip>
      )}
    </div>
  );
}

function SendArrow() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3.5M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

"use client";

// The open card's reply box on weft.zip, where the desktop's sits under the thread. What you send is a `reply`
// command for the Mac that runs the card (lib/cloud-inbox.ts), which sends it as if typed there: now, or after the
// turn that's running. Under the box, each reply still on its way (or refused) and what the Mac has queued for the
// turn's end. A card a teammate runs can't be answered from here, since only its own account's Mac obeys. The
// Continue button sends the word "continue" through the same path; it mirrors the desktop's ▶ button, which
// the Mac receives and routes like any other reply (lib/resume-actions.ts).
import { useState } from "react";
import { commandText, type CloudCommandRow } from "@/lib/cloud-commands";
import type { Card } from "@/lib/types";
import { replyNote } from "@/lib/web-commands";
import Icon from "@/components/Icon";
import { track } from "@/lib/analytics";

export function WebReplyBox({
  card,
  canReply,
  replies,
  onSend,
  onDrop,
}: {
  card: Card;
  canReply: boolean;
  replies: CloudCommandRow[];
  onSend: (text: string) => Promise<string | null>;
  onDrop: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canReply)
    return (
      <footer className="shrink-0 px-4 pb-3 pt-1">
        <p className="rounded-xl border border-line bg-sunken px-4 py-3 text-[13px] text-faint">Read-only here: this thread runs on a teammate&apos;s Mac.</p>
      </footer>
    );

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const failed = await onSend(text);
    setSending(false);
    setError(failed);
    if (!failed) {
      track("thread_reply_sent", { reply_type: "message" });
      setText("");
    }
  };
  // Continue: send "continue" through the same path. The Mac treats it as a fresh user message, which
  // the desktop's ▶ already does (lib/resume-actions.ts). Disabled while a reply is in flight, like Send.
  const sendContinue = async () => {
    if (sending) return;
    setSending(true);
    const failed = await onSend("continue");
    setSending(false);
    setError(failed);
    if (!failed) track("thread_reply_sent", { reply_type: "continue" });
  };
  const queued = (card.scheduled ?? []).filter((m) => m.afterTurn);

  return (
    <footer className="shrink-0 px-4 pb-3 pt-1">
      {(queued.length > 0 || replies.length > 0) && (
        <ul className="mb-2 flex flex-col gap-1 text-[12px]">
          {queued.map((m) => (
            <li key={m.id} className="truncate text-muted" title={m.text}>
              <span className="text-faint">After this turn:</span> {m.text}
            </li>
          ))}
          {replies.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-muted" title={commandText(r)}>{commandText(r)}</span>
              <span className={`shrink-0 ${r.status === "failed" ? "text-danger" : "text-faint"}`}>{replyNote(r)}</span>
              {(r.status === "pending" || r.status === "failed") && (
                <button type="button" onClick={() => onDrop(r.id)} className="shrink-0 text-faint underline hover:text-ink">
                  {r.status === "failed" ? "Dismiss" : "Cancel"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2 rounded-xl border border-line-strong bg-sunken px-3 py-2 focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Reply"
          value={text}
          rows={2}
          placeholder="Reply… it goes to the thread on your Mac"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="min-h-[2.5rem] flex-1 resize-none bg-transparent text-[13px] text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void sendContinue()}
          disabled={sending}
          aria-label="Continue"
          title="Continue: send “continue” so the thread keeps going"
          className="flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40"
        >
          <Icon name="play" size={11} /> Continue
        </button>
        <button type="submit" disabled={!text.trim() || sending} className="rounded-md bg-accent px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-40">
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </footer>
  );
}

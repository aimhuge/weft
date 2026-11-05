"use client";

// Above the open card's reply box on weft.zip (ThreadPanel's footer): what this board sent the card that hasn't
// reached its thread yet (a reply, an answer or a Stop, as commands the Mac that runs the card picks up,
// lib/cloud-inbox.ts) or that failed. The reply box itself is the desktop's (components/ReplyBox.tsx), and since it
// can send later here too (lib/cloud-host-acts.ts) it draws the card's scheduled and after-this-turn messages itself. On a card a teammate runs, a note says why there's no reply box: only its own
// account's Mac obeys.
import { commandText, type CloudCommandRow } from "@/lib/cloud-commands";
import { replyNote } from "@/lib/web-commands";

export function WebReplyStatus({ canReply, replies, onDrop }: { canReply: boolean; replies: CloudCommandRow[]; onDrop: (id: string) => void }) {
  if (!canReply)
    return (
      <div className="shrink-0 border-t border-line px-4 py-2">
        <p className="text-[12.5px] text-faint">Read-only here: this thread runs on a teammate&apos;s Mac.</p>
      </div>
    );
  if (!replies.length) return null;
  return (
    <ul className="flex shrink-0 flex-col gap-1 border-t border-line px-4 py-2 text-[12px]">
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
  );
}

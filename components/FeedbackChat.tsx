"use client";

import { useEffect, useRef, useState } from "react";
import type { useFeedback } from "@/lib/use-feedback";

// The feedback dot's popover (components/FeedbackDot.tsx): the interview, then the summary to check and send.
export default function FeedbackChat({ chat, onClose }: { chat: ReturnType<typeof useFeedback>; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { messages, summary, busy, error, sent } = chat;

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, summary, busy, sent]);
  useEffect(() => input.current?.focus(), []);

  const submit = () => {
    if (!draft.trim() || busy) return;
    chat.say(draft);
    setDraft("");
  };

  return (
    <div role="dialog" aria-label="Feedback" className="absolute bottom-full right-0 z-50 mb-2 flex h-[420px] max-h-[70vh] w-80 flex-col overflow-hidden rounded-lg border border-line bg-panel text-[13px] text-ink shadow-lg whitespace-normal">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-medium">What&apos;s in your way?</span>
        <button type="button" onClick={onClose} aria-label="Close feedback" className="text-muted hover:text-ink">✕</button>
      </div>
      <div ref={list} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.map((m, i) => (
          <p key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 ${m.role === "user" ? "ml-auto bg-accent text-on-accent" : "bg-card"}`}>
            {m.text}
          </p>
        ))}
        {busy && <p className="text-muted">{summary ? "Sending…" : "Thinking…"}</p>}
        {summary && (
          <div className="rounded-lg border border-accent/40 bg-accent-soft/40 p-2.5">
            <p className="mb-1 font-medium">{summary.title}</p>
            <p className="whitespace-pre-wrap text-muted">{summary.body}</p>
          </div>
        )}
        {sent !== null && (
          <p className={sent ? "text-ok" : "text-danger"}>
            {sent ? "Sent to the Weft team. Thank you!" : "Couldn't reach weft.zip, so it's kept on your Mac in ~/.weft/feedback."}
          </p>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
      {sent !== null ? (
        <div className="border-t border-line p-2 text-right">
          <button type="button" onClick={chat.reset} className="rounded px-2 py-1 text-accent hover:bg-accent-soft">New feedback</button>
        </div>
      ) : summary ? (
        <div className="flex justify-end gap-2 border-t border-line p-2">
          <button type="button" onClick={() => input.current?.focus()} disabled={busy} className="rounded px-2 py-1 text-muted hover:text-ink">Add more</button>
          <button type="button" onClick={() => void chat.send()} disabled={busy} className="rounded bg-accent px-2.5 py-1 font-medium text-on-accent disabled:opacity-50">Send to the Weft team</button>
        </div>
      ) : null}
      {sent === null && (
        <div className="border-t border-line p-2">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder={summary ? "Anything to add or correct?" : "Type your answer…"}
            className="w-full resize-none rounded border border-line bg-card px-2 py-1 outline-none focus:border-accent"
          />
          {chat.answered && !summary && (
            <button type="button" onClick={chat.wrapUp} disabled={busy} className="mt-1 text-[11.5px] text-muted hover:text-ink disabled:opacity-50">
              That&apos;s all: write the summary
            </button>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// The copilot's peek: its latest reply or idea above the launcher, with a quick-ask box (the header's maximize opens
// the chat); it closes itself 6s after the mouse leaves. It shows no card counts: the swim lanes already say what
// needs you and what finished.
import { useEffect, useState } from "react";
import { lastReply } from "@/lib/copilot-lane";
import type { PersonaInfo } from "@/lib/copilot-personas";
import type { ThreadItem } from "@/lib/types";

export default function Peek(props: {
  persona: PersonaInfo;
  items: ThreadItem[];
  error: string | null;
  onHide: () => void;
  onOpen: () => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const reply = lastReply(props.items, 320);

  // The peek is the kind of pane you glance at, then look away. Auto-close 6s after the mouse leaves
  // the peek, so it gets out of the board's way without you having to find the ×.
  const [armed, setArmed] = useState(true);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(props.onHide, 6000);
    return () => window.clearTimeout(id);
  }, [armed, props.onHide]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2"
      onMouseEnter={() => setArmed(false)}
      onMouseLeave={() => setArmed(true)}
    >
      {props.error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-[11.5px] text-danger">{props.error}</p>}
      <button
        onClick={props.onOpen}
        className="rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-left text-[12px] leading-snug text-ink hover:border-accent/60"
      >
        {reply ? (
          <>
            <span className="font-semibold text-accent">{props.persona.name}:</span> {reply}
          </>
        ) : (
          <span className="text-muted">Ask me what to build next, or to shape an idea into cards.</span>
        )}
      </button>
      <form
        className="mt-auto"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text) return;
          setDraft("");
          props.onAsk(text);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setArmed(false)}
          placeholder="Ask the copilot…"
          className="w-full rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </form>
    </div>
  );
}

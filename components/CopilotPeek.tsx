"use client";

// The copilot's peek: the digest above the launcher with a quick-ask box (the header's maximize opens
// the chat); it closes itself 6s after the mouse leaves.
import { useEffect, useState } from "react";
import { laneDigest } from "@/lib/copilot-lane";
import type { PersonaInfo } from "@/lib/copilot-personas";
import type { Card } from "@/lib/types";

export default function Peek(props: {
  cards: Card[];
  persona: PersonaInfo;
  items: Parameters<typeof laneDigest>[1];
  error: string | null;
  onHide: () => void;
  onOpen: () => void;
  onOpenCard: (card: Card) => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const digest = laneDigest(props.cards, props.items);
  const waiting = digest.needsYou.length;

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
      <div className="rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-2 text-[12px] leading-snug text-ink">
        <span className="font-semibold text-accent">Since you last asked:</span> {digest.finished} finished
        {waiting > 0 ? `, ${waiting} need${waiting === 1 ? "s" : ""} you` : ", nothing waiting on you"}.
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {digest.needsYou.slice(0, 3).map((card) => (
          <button
            key={card.id}
            onClick={() => props.onOpenCard(card)}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-[12px] leading-snug text-ink hover:border-line-strong"
          >
            <span className="font-semibold text-warn">Needs you:</span> {card.title}
          </button>
        ))}
        {digest.lastReply && (
          <button
            onClick={props.onOpen}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-left text-[12px] leading-snug text-muted hover:border-line-strong"
          >
            <span className="font-semibold text-ink">{props.persona.name}:</span> {digest.lastReply}
          </button>
        )}
      </div>
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

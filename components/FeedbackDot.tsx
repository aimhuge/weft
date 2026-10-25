"use client";

import { useEffect, useRef, useState } from "react";
import { useOverlay } from "@/lib/overlay";
import { useFeedback } from "@/lib/use-feedback";
import FeedbackChat from "./FeedbackChat";

// The little dot at the board's bottom-right corner: opens a chat where Haiku interviews you about what's in your
// way, then sends the summary you checked to the Weft team's Slack (lib/feedback.ts, docs/architecture/feedback.md).
// The dot is small on purpose (screen space is precious), so it names itself on hover or keyboard focus: a bare
// purple dot in the corner is invisible to anyone who hasn't been told about it.
export default function FeedbackDot() {
  const [open, setOpen] = useState(false);
  const chat = useFeedback();
  const box = useRef<HTMLDivElement>(null);
  // The browser pane is a native view over the page; it steps aside while the chat is up.
  useOverlay(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={box} className="group/feedback relative ml-3 inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Feedback: tell the Weft team what's in your way"
        aria-label="Feedback"
        aria-expanded={open}
        className="grid size-4 place-items-center rounded-full"
      >
        <span className="size-2 rounded-full bg-accent transition-transform group-hover/feedback:scale-125" />
      </button>
      {/* The name, revealed on hover or focus so the dot reads as a control, not decoration. It sits to the left of
          the dot, since the chat popover opens above it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-full top-1/2 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded border border-line bg-panel px-1.5 py-0.5 text-[11px] font-medium text-ink opacity-0 transition-opacity group-hover/feedback:opacity-100 focus-within:opacity-100"
      >
        Feedback
      </span>
      {open && <FeedbackChat chat={chat} onClose={() => setOpen(false)} />}
    </div>
  );
}

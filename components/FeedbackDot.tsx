"use client";

import { useEffect, useRef, useState } from "react";
import { useOverlay } from "@/lib/overlay";
import { useFeedback } from "@/lib/use-feedback";
import FeedbackChat from "./FeedbackChat";

// The little dot at the board's bottom-right corner: opens a chat where Haiku interviews you about what's in your
// way, then sends the summary you checked to the Weft team's Slack (lib/feedback.ts, docs/architecture/feedback.md).
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
    <div ref={box} className="relative ml-3 inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Feedback: tell the Weft team what's in your way"
        aria-label="Feedback"
        aria-expanded={open}
        className="group grid size-4 place-items-center rounded-full"
      >
        <span className="size-2 rounded-full bg-accent transition-transform group-hover:scale-125" />
      </button>
      {open && <FeedbackChat chat={chat} onClose={() => setOpen(false)} />}
    </div>
  );
}

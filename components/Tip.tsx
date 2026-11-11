"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentArea, fitWidth, placeAbove } from "@/lib/float-place";

// Narrower than this, the room left of the browser pane can't hold a readable bubble, so the shell draws it.
const NATIVE_BELOW = 160;

// Squeezed beside the browser pane (a rail icon with the pane right of it), the tip goes to a small
// window of the shell's that floats over the pane; the bubble stays hidden and only lends its text.
function showNative(trigger: HTMLElement, bubble: HTMLElement, width: number): (() => void) | undefined {
  const bridge = window.weft;
  if (!bridge?.tip || fitWidth(currentArea(), width) >= NATIVE_BELOW) return undefined;
  const zoom = bridge.zoomFactor?.() ?? 1;
  const r = trigger.getBoundingClientRect();
  bridge.tip.show(bubble.innerText || bubble.textContent || "", { x: r.left * zoom, y: r.top * zoom, width: r.width * zoom, height: r.height * zoom });
  return () => bridge.tip?.hide();
}

// How long an interactive bubble stays after the mouse leaves its trigger: enough to cross the 6px gap.
const CLOSE_DELAY = 250;

// A hover bubble above its child, kept inside the window and out from under the browser pane. Native title tooltips don't show in the
// desktop app, so this draws its own, in a portal so no panel or dialog can clip it. An `interactive` bubble holds a button
// of its own: it takes clicks, and stays open while the mouse crosses the gap into it.
export default function Tip({
  text,
  children,
  className = "",
  off = false,
  width = 260,
  interactive = false,
}: {
  text: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  off?: boolean;
  // The bubble's widest, for a tip that holds more than a sentence (a chart).
  width?: number;
  interactive?: boolean;
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
    setOpen(true);
  }
  // A plain tip closes at once; an interactive one waits long enough for the mouse to reach it.
  function hide() {
    if (!interactive) {
      setOpen(false);
      return;
    }
    if (closing.current) clearTimeout(closing.current);
    closing.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  }
  useEffect(() => () => {
    if (closing.current) clearTimeout(closing.current);
  }, []);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubble.current) {
      setPos(null);
      return;
    }
    // Squeezed beside the pane, the shell draws it and the bubble stays hidden.
    const native = interactive ? undefined : showNative(trigger.current, bubble.current, width);
    if (native) {
      setPos(null);
      return native;
    }
    // Inside the window and clear of the browser pane, which no z-index can rise above.
    setPos(placeAbove(trigger.current.getBoundingClientRect(), bubble.current.getBoundingClientRect(), currentArea()));
  }, [open, text, interactive, width]);

  return (
    <span
      ref={trigger}
      className={`cursor-default ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {open &&
        !off &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? hide : undefined}
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              maxWidth: fitWidth(currentArea(), width),
              visibility: pos ? "visible" : "hidden",
            }}
            className={`${interactive ? "" : "pointer-events-none "}fixed z-[100] w-max rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-sans text-[11.5px] leading-snug text-ink shadow-lg`}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

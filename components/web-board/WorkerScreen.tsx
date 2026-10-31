"use client";

// A worker's device, live in the pane (lib/worker-screen.ts): frames off a Realtime topic, drawn on one <img>. A click is
// a tap and a drag a swipe, sent as commands where the board can send them (onInput); elsewhere it only watches.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { SharePane } from "@/lib/share-types";
import { gesture, useScreenStream, type Point } from "@/lib/use-screen-stream";
import type { ScreenInput } from "@/lib/worker-commands";

// How often the status line looks at the clock, to say the watch ran out.
const CLOCK_MS = 5_000;
const RIPPLE_MS = 400;

type ScreenPane = Extract<SharePane, { kind: "screen" }>;

function pointIn(el: HTMLElement, e: PointerEvent): Point {
  const r = el.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  return { x: px / r.width, y: py / r.height, px, py };
}

function statusLine(ended: boolean, src: string | null, canTap: boolean, until: number) {
  if (ended) return "Paused: ask the thread to watch again";
  if (!src) return "Waiting for the first frame…";
  const time = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${canTap ? "Live · tap and drag on the screen" : "Live"} · until ${time}`;
}

export function WorkerScreen({ pane, onInput }: { pane: ScreenPane; onInput?: (input: ScreenInput) => Promise<unknown> }) {
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Where the last press landed: the answer takes a moment to come back, so the press shows at once.
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const down = useRef<(Point & { at: number }) | null>(null);
  useScreenStream(pane.token, setSrc);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const press = (e: PointerEvent<HTMLImageElement>) => {
    if (!onInput) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = { ...pointIn(e.currentTarget, e), at: Date.now() };
  };
  const release = (e: PointerEvent<HTMLImageElement>) => {
    const from = down.current;
    if (!from || !onInput) return;
    down.current = null;
    setNote("");
    setRipple({ x: e.clientX, y: e.clientY });
    setTimeout(() => setRipple(null), RIPPLE_MS);
    onInput(gesture(pane.device, from, pointIn(e.currentTarget, e), Date.now() - from.at)).catch((err: unknown) => setNote((err as Error).message));
  };

  return (
    <div className="flex h-full flex-col items-center gap-2 overflow-hidden p-3">
      <p className="shrink-0 text-[12px] text-muted">
        <b className="text-ink">{pane.label}</b> · {statusLine(now > pane.until, src, Boolean(onInput), pane.until)}
      </p>
      {/* Sized to the picture, never letterboxed: a press is read as a fraction of this box. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {src && (
          <img
            src={src}
            alt={`${pane.label}'s screen`}
            draggable={false}
            onPointerDown={press}
            onPointerUp={release}
            className={`max-h-full max-w-full touch-none rounded-2xl border-4 border-line ${onInput ? "cursor-pointer" : ""}`}
          />
        )}
      </div>
      {ripple && <span data-testid="ripple" className="pointer-events-none fixed size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-white/50" style={{ left: ripple.x, top: ripple.y }} />}
      {note && <p className="shrink-0 text-center text-[12px] text-warn">{note}</p>}
    </div>
  );
}

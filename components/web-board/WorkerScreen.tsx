"use client";

// A worker's device, live in the pane (lib/worker-screen.ts): frames off a Realtime topic, drawn on one <img>, or H.264
// over WebRTC where the board can connect (lib/use-rtc-screen.ts): a video track in a <video>, or a canvas from an older worker. There, touches and keys stream live as they
// happen, and a paste types the clipboard's text; otherwise a click is a tap and a drag a swipe, sent as commands (onInput). A board with neither only watches.
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { SharePane } from "@/lib/share-types";
import { hidUsage } from "@/lib/hid-keys";
import { isBrowserScreen } from "@/lib/host-line-protocol";
import { pasteEvent } from "@/lib/rtc-signal";
import { useScreenVideo } from "@/lib/use-line-screen";
import { gesture, useScreenStream, type Point } from "@/lib/use-screen-stream";
import type { BoardInput } from "@/lib/worker-commands";
import { ScreenBar, useScreenQuality } from "./ScreenBar";

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

function statusLine(ended: boolean, src: string | null, canTap: boolean, until: number, direct: boolean) {
  if (ended) return canTap ? "Paused" : "Paused: ask the thread to watch again";
  if (!src && !direct) return "Waiting for the first frame…";
  const time = new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${canTap ? "Live · tap and drag on the screen" : "Live"}${direct ? " · direct video" : ""} · until ${time}`;
}

// source: the worker's name, for "streaming from"; the web board, which doesn't know it, says "the worker". workerId: the
// worker whose session line carries the video as a track when it's up; otherwise the screen opens a line of its own.
export function WorkerScreen({ pane, onInput, source, workerId }: { pane: ScreenPane; onInput?: (input: BoardInput) => Promise<unknown>; source?: string; workerId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Where the last press landed: the answer takes a moment to come back, so the press shows at once.
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const down = useRef<(Point & { at: number }) | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [quality, pickQuality] = useScreenQuality();
  // The page a watch started from here is waiting to replace: the new page ends the wait.
  const [startedOn, setStartedOn] = useState<string | null>(null);
  const starting = startedOn === pane.url;
  const { live, track, send, answer } = useScreenVideo(onInput ? workerId : undefined, pane.device, pane.fast, canvas, onInput, quality, video);
  useScreenStream(pane.token, setSrc, answer);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const press = (e: PointerEvent<HTMLElement>) => {
    if (!onInput) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = pointIn(e.currentTarget, e);
    down.current = { ...at, at: Date.now() };
    send({ t: "down", x: at.x, y: at.y });
    e.currentTarget.focus();
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!down.current) return;
    const at = pointIn(e.currentTarget, e);
    send({ t: "move", x: at.x, y: at.y });
  };
  const release = (e: PointerEvent<HTMLElement>) => {
    const from = down.current;
    if (!from || !onInput) return;
    down.current = null;
    setNote("");
    setRipple({ x: e.clientX, y: e.clientY });
    setTimeout(() => setRipple(null), RIPPLE_MS);
    const at = pointIn(e.currentTarget, e);
    if (send({ t: "up", x: at.x, y: at.y })) return;
    onInput(gesture(pane.device, from, at, Date.now() - from.at)).catch((err: unknown) => setNote((err as Error).message));
  };
  const key = (e: KeyboardEvent<HTMLElement>, isDown: boolean) => {
    const code = hidUsage(e.code);
    if (code === null || e.metaKey || e.ctrlKey || e.repeat) return;
    if (send({ t: "key", code, down: isDown })) e.preventDefault();
  };
  // A paste gesture (⌘V on the focused screen) types the clipboard's text on the device, over the live line only: the
  // board never reads the clipboard on its own.
  const paste = (e: ClipboardEvent<HTMLElement>) => {
    const event = pasteEvent(e.clipboardData.getData("text/plain"));
    if (event && send(event)) e.preventDefault();
  };
  const ended = now > pane.until;
  const watch = (device: string) => {
    if (!onInput) return;
    setStartedOn(pane.url);
    setNote("");
    onInput({ kind: "watch", device }).catch((err: unknown) => {
      setStartedOn(null);
      setNote((err as Error).message);
    });
  };
  const handlers = { onPointerDown: press, onPointerMove: move, onPointerUp: release, onKeyDown: (e: KeyboardEvent<HTMLElement>) => key(e, true), onKeyUp: (e: KeyboardEvent<HTMLElement>) => key(e, false), onPaste: paste };
  const surface = `max-h-full max-w-full touch-none rounded-2xl border-4 border-line ${onInput ? "cursor-pointer" : ""}`;

  return (
    <div className="flex h-full flex-col items-center gap-2 overflow-hidden p-3">
      <ScreenBar
        label={pane.label}
        device={pane.device}
        devices={pane.devices}
        source={source}
        status={statusLine(ended, src, Boolean(onInput), pane.until, live)}
        ended={ended}
        watch={onInput ? watch : undefined}
        busy={starting}
        quality={pane.fast && onInput && !isBrowserScreen(pane.device) ? { value: quality, pick: pickQuality } : undefined}
      />
      {/* Sized to the picture, never letterboxed: a press is read as a fraction of this box. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <canvas ref={canvas} tabIndex={0} {...handlers} className={live && !track ? `${surface} outline-none` : "hidden"} />
        <video ref={video} tabIndex={0} muted playsInline {...handlers} className={track ? `${surface} outline-none` : "hidden"} />
        {src && !live && (
          <img
            src={src}
            alt={`${pane.label}'s screen`}
            draggable={false}
            onPointerDown={press}
            onPointerUp={release}
            className={surface}
          />
        )}
      </div>
      {ripple && <span data-testid="ripple" className="pointer-events-none fixed size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-white/50" style={{ left: ripple.x, top: ripple.y }} />}
      {note && <p className="shrink-0 text-center text-[12px] text-warn">{note}</p>}
    </div>
  );
}

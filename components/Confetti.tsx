"use client";

import { useEffect, useRef } from "react";
import { burst, step } from "@/lib/confetti";

// One burst of confetti over the whole window (lib/confetti.ts moves it), then `onDone`. It never takes a
// click, and with Reduce motion on it draws nothing and is done at once.
export default function Confetti({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current();
      return;
    }
    const { innerWidth: w, innerHeight: h, devicePixelRatio: dpr } = window;
    el.width = w * dpr;
    el.height = h * dpr;
    ctx.scale(dpr, dpr);
    let pieces = burst(w, h);
    let last = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      // A tab in the background pauses frames; don't let the paper teleport when it comes back.
      pieces = step(pieces, Math.min((now - last) / 1000, 0.05), w, h);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.flip), p.w, p.h * Math.cos(p.flip));
        ctx.restore();
      }
      if (pieces.length) frame = requestAnimationFrame(draw);
      else done.current();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[95] h-full w-full" />;
}

"use client";

import { useEffect, useState } from "react";

// Where an element on the board is, for something drawn fixed over it (the empty board's start panel). Measured
// after mount, on resize, scroll and the element's own resizes, and every half second, since a column also moves
// without resizing (an open card or the side pane closes); state only changes when the rect does. null while nothing matches the selector.
export type AnchorRect = { top: number; left: number; width: number; height: number; headerBottom: number };

function measure(selector: string): AnchorRect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const header = el.firstElementChild?.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, headerBottom: header ? header.bottom : r.top };
}

const same = (a: AnchorRect | null, b: AnchorRect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height && a.headerBottom === b.headerBottom);

export function useAnchorRect(selector: string | null): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  useEffect(() => {
    if (!selector) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(selector);
        setRect((prev) => (same(prev, next) ? prev : next));
      });
    };
    update();
    const timer = setInterval(update, 500);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const el = document.querySelector(selector);
    if (el && observer) observer.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [selector]);
  return selector ? rect : null;
}

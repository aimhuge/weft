"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

// Where the open card sits in simple mode's command center (docs/architecture/simple-mode.md, piece 4): right of the
// board's sidebar, from the sidebar's top (under the header, the project tabs and the filters) to its bottom (above
// the footer and an open terminal), out to the window's right edge. The card measures the sidebar itself, as the
// window, the rail's drawer or the terminal move it, so nothing has to hand it the numbers.
//
// A fixed box inside a transformed ancestor is placed against that ancestor, not the window, so the frame's own
// origin (where left: 0, top: 0 lands) is measured and taken off. Null while off or with no sidebar on the board.
export type Origin = { x: number; y: number };

export function slotFor(sidebar: DOMRect, viewportWidth: number, origin: Origin = { x: 0, y: 0 }): CSSProperties {
  return {
    left: Math.round(sidebar.right - origin.x),
    top: Math.round(sidebar.top - origin.y),
    width: Math.max(0, Math.round(viewportWidth - sidebar.right)),
    height: Math.max(0, Math.round(sidebar.height)),
  };
}

// The frame's origin: its box on screen less the left and top it was given.
export function originOf(frame: HTMLElement | null): Origin {
  if (!frame) return { x: 0, y: 0 };
  const box = frame.getBoundingClientRect();
  return { x: box.left - (parseFloat(frame.style.left) || 0), y: box.top - (parseFloat(frame.style.top) || 0) };
}

const same = (a: CSSProperties | null, b: CSSProperties) =>
  a !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

export function useBoardSlot(on: boolean): { slot: CSSProperties | null; frame: RefObject<HTMLDivElement | null> } {
  const [slot, setSlot] = useState<CSSProperties | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sidebar = on ? document.querySelector<HTMLElement>("[data-board-sidebar]") : null;
    if (!sidebar) return;
    const place = () => {
      const next = slotFor(sidebar.getBoundingClientRect(), window.innerWidth, originOf(frame.current));
      setSlot((prev) => (same(prev, next) ? prev : next));
    };
    place();
    // Once the frame is drawn its origin is known: place again so it lands exactly beside the sidebar.
    const settle = requestAnimationFrame(place);
    // The sidebar keeps its width when the rail's drawer opens beside it, so the rail is watched too.
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watch?.observe(sidebar);
    if (sidebar.previousElementSibling) watch?.observe(sidebar.previousElementSibling);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(settle);
      watch?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [on]);
  return { slot: on ? slot : null, frame };
}

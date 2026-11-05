"use client";

// An element's inner size (clientWidth/clientHeight), kept current by a ResizeObserver. The board measures
// itself with it to decide which columns have room to widen (lib/board-overflow.ts). 0 x 0 until mounted.
import { useEffect, useState, type RefObject } from "react";

export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setSize((was) => (was.width === el.clientWidth && was.height === el.clientHeight ? was : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

"use client";

import { useSyncExternalStore } from "react";
import { loopSrc } from "@/lib/welcome-loop";

// The Get ready hero: a 26-second loop of a card going Running → Needs you → Review → Done (with a 🔐 vault beat), with your own project names
// on the cards (public/welcome/loop.html, a HyperFrames composition; lib/welcome-loop.ts). It's a sandboxed iframe that
// only plays, so nothing in it can be clicked or focused. With reduced motion on, it's the still board screenshot instead.

const STILL = "/brand/faq/tour-board.jpg";
const ALT = "A Weft board with threads in Running, Needs you, Review and Done";

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const useReducedMotion = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(REDUCE).matches,
    () => false,
  );

export function WelcomeLoop({ projects }: { projects: string[] }) {
  const reduced = useReducedMotion();
  if (reduced) return <img src={STILL} alt={ALT} className="aspect-[12/5] w-full object-cover object-top" />;
  return (
    <iframe
      src={loopSrc(projects)}
      title="How Weft works: a card goes from Running to Needs you, Review and Done"
      sandbox="allow-scripts"
      tabIndex={-1}
      className="pointer-events-none block aspect-[12/5] w-full border-0 bg-[#0d0f14]"
    />
  );
}

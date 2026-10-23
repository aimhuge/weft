"use client";

import { useRef, useSyncExternalStore } from "react";
import { useAccount } from "@/lib/use-account";
import { useWelcomeTour } from "@/lib/use-welcome-tour";
import { loopSrc } from "@/lib/welcome-loop";

// The Get ready hero: the whole tour, live (lib/welcome-loop.ts): loop.html, a card going Running → Needs you → the 🔐
// vault → Review → Done with your own project names on it, then beats.html, connect your tools, the Wefter Profile and
// code quality, round and round. It's a sandboxed iframe that only plays, so nothing in it can be clicked or focused;
// the pages post which beat is on screen, and during the profile beat a real Sign in with GitHub button sits over it.
// Once you're signed in, the profile beat shows your name and avatar. It's narrated (scripts/narrate-welcome.mjs): each
// page's voiceover starts as the page does, on by default, with a mute button. With reduced motion on, it's the still board.

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
  const frame = useRef<HTMLIFrameElement>(null);
  const { state, busy, waiting, signIn } = useAccount();
  const user = state.kind === "ready" ? state.view.user : null;
  const canSignIn = state.kind === "ready" && state.view.configured && !user;
  const who = user ? { name: user.name ?? user.email?.split("@")[0] ?? "You", avatar: user.avatar } : null;
  const { beat, muted, toggleMuted } = useWelcomeTour(frame, who);

  if (reduced) return <img src={STILL} alt={ALT} className="aspect-[12/5] w-full object-cover object-top" />;
  return (
    <div className="relative">
      <iframe
        ref={frame}
        src={loopSrc(projects)}
        title="How Weft works: a card goes from Running to Needs you, Review and Done, then your tools, profile and code quality"
        sandbox="allow-scripts"
        tabIndex={-1}
        className="pointer-events-none block aspect-[12/5] w-full border-0 bg-[#0d0f14]"
      />
      <button
        type="button"
        onClick={toggleMuted}
        aria-label={muted ? "Turn narration on" : "Mute narration"}
        className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-[12px] text-white hover:bg-black/80"
      >
        {muted ? "🔇" : "🔊"}
      </button>
      {beat === "profile" && canSignIn && (
        <button
          type="button"
          onClick={() => void signIn("github")}
          disabled={busy !== null}
          className="absolute right-3 top-[17%] flex items-center gap-1.5 rounded-md bg-[#1d1d1f] px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg hover:bg-black disabled:opacity-70"
        >
          {waiting ? "Finish in your browser…" : "Sign in with GitHub for your profile"}
        </button>
      )}
    </div>
  );
}

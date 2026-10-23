"use client";

import { useRef, useSyncExternalStore } from "react";
import { useAccount } from "@/lib/use-account";
import { trackOnboarding } from "@/lib/telemetry-client";
import { useWelcomeTour } from "@/lib/use-welcome-tour";
import { loopSrc } from "@/lib/welcome-loop";
import { WelcomeTourBar } from "./WelcomeTourBar";

// The Get ready hero: the whole tour, live (lib/welcome-loop.ts): intro.html, then loop.html, a card going Running →
// Needs you → the 🔐 vault → Review → Done with your own project names on it, then beats.html, connect your tools, panes,
// code quality, BlastCP, the Wefter Profile and open source, round and round. It's a sandboxed iframe that only plays, so nothing in it can be clicked or focused;
// the pages post which beat is on screen, and during the profile beat a real Sign in with GitHub button sits over it.
// Once you're signed in, the profile beat shows your name and avatar. It's narrated (scripts/narrate-welcome.mjs): each
// page's voiceover starts as the page does, on by default. Under it, the tour bar (components/WelcomeTourBar.tsx) names
// the beat on screen, steps Back and Next a beat at a time and mutes the voice. With reduced motion on, it's the still board.

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
  const { beat, muted, toggleMuted, go } = useWelcomeTour(frame, who);

  if (reduced) return <img src={STILL} alt={ALT} className="aspect-[12/5] w-full object-cover object-top" />;
  return (
    <div>
      <div className="relative">
        <iframe
          ref={frame}
          src={loopSrc(projects)}
          title="How Weft works: a card goes from Running to Needs you, Review and Done, then your tools, profile and code quality"
          sandbox="allow-scripts"
          tabIndex={-1}
          className="pointer-events-none block aspect-[12/5] w-full border-0 bg-[#0d0f14]"
        />
        {beat === "profile" && canSignIn && (
          <button
            type="button"
            onClick={() => {
              trackOnboarding("onboarding_signin_clicked");
              void signIn("github");
            }}
            disabled={busy !== null}
            className="absolute right-3 top-[17%] flex items-center gap-1.5 rounded-md bg-[#1d1d1f] px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg hover:bg-black disabled:opacity-70"
          >
            {waiting ? "Finish in your browser…" : "Sign in with GitHub for your profile"}
          </button>
        )}
      </div>
      <WelcomeTourBar beat={beat} go={go} muted={muted} toggleMuted={toggleMuted} />
    </div>
  );
}

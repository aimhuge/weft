"use client";

import { useEffect, useState } from "react";
import type { Welcome } from "@/lib/welcome";
import { resetTips, TIPS_CHANGED } from "@/lib/tips";
import { changeWelcome, loadWelcome, TEST_EVENT } from "@/lib/welcome-client";
import SwitchRow from "./SwitchRow";

// Settings → General: the welcome's two answers, changed later (lib/welcome.ts). Count your Claude Code
// history on your Wefter Profile, and bring in the sessions Start fresh or unticked projects left out.
export default function HistorySettings() {
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadWelcome()
      .then((v) => setWelcome(v.welcome))
      .catch(() => {});
  }, []);

  if (!welcome) return null;
  const change = (patch: { countHistory: boolean } | { importAll: true } | { test: true }) => {
    setBusy(true);
    setError("");
    changeWelcome(patch)
      .then((v) => {
        if ("test" in patch) window.dispatchEvent(new Event(TEST_EVENT));
        else setWelcome(v.welcome);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  const leftOut = welcome.fresh || welcome.skip.length > 0;
  return (
    <>
      <SwitchRow
        title="Count my Claude Code history"
        hint="Your sessions from before Weft count toward XP, streaks and your class on your Wefter Profile. Off starts it from the day you started Weft."
        on={welcome.countHistory}
        onChange={(on) => change({ countHistory: on })}
      />
      <section className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-ink">The welcome</h3>
          <p className="text-[12.5px] text-muted">Run the first-launch screens again for real (your agents, your projects and a first thread) and save your answers; to just look, use Replay the welcome in your avatar&rsquo;s menu or the command palette. Reset tips brings back the column tips on the board.</p>
        </div>
        <span className="flex shrink-0 gap-1.5">
          <button type="button" disabled={busy} onClick={() => change({ test: true })} className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40">
            Test it
          </button>
          <button
            type="button"
            onClick={() => {
              resetTips();
              window.dispatchEvent(new Event(TIPS_CHANGED));
            }}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
          >
            Reset tips
          </button>
        </span>
      </section>
      {leftOut && (
        <section className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[13px] font-medium text-ink">Claude Code sessions left out</h3>
            <p className="text-[12.5px] text-muted">
              {welcome.fresh ? "You started fresh, so sessions from before Weft aren't on the board." : `${welcome.skip.length} project folder${welcome.skip.length === 1 ? "" : "s"} left out at the welcome.`}
            </p>
            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>
          <button type="button" disabled={busy} onClick={() => change({ importAll: true })} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40">
            Bring them in
          </button>
        </section>
      )}
    </>
  );
}

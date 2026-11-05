"use client";

import { useState } from "react";
import { AWAY_MINUTES, type AwayPrefs, awayPrefs, setAwayPrefs } from "@/lib/away-open";
import SwitchRow from "./SwitchRow";

// Away open (lib/away-open.ts): the switch and how long without input counts as away. Saves right away.
export default function AwaySettings() {
  // The dialog only mounts in the browser, so the cookie is there to read.
  const [prefs, setPrefs] = useState<AwayPrefs>(awayPrefs);

  function update(next: AwayPrefs) {
    setAwayPrefs(next);
    setPrefs(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <SwitchRow
        title="Open cards that need you while I'm away"
        hint="With no card open and no mouse or keys on the board for a while, a card that moves to Needs you opens by itself. Ones after it stack behind it: answer one and the next opens."
        on={prefs.on}
        onChange={(on) => update({ ...prefs, on })}
      />
      <label className={`flex items-center gap-3 text-[13px] text-ink ${prefs.on ? "" : "opacity-50"}`}>
        Away after
        <select
          value={prefs.minutes}
          disabled={!prefs.on}
          onChange={(e) => update({ ...prefs, minutes: Number(e.target.value) })}
          className="rounded-md border border-line-strong bg-panel px-2 py-1 text-[13px]"
        >
          {AWAY_MINUTES.map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "minute" : "minutes"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

"use client";

import { useUiText } from "@/lib/ui-language";
import { useState } from "react";
import { CHIMES, CHIME_KINDS, type ChimePrefs, chimePrefs, previewChime, setChimePrefs } from "@/lib/chimes";

// Chimes when a card changes column. Like Appearance, every change saves right away.
export default function SoundSettings({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const t = useUiText();
  // The dialog only mounts in the browser, so the cookie is there to read.
  const [prefs, setPrefs] = useState<ChimePrefs>(chimePrefs);

  function update(next: ChimePrefs) {
    setChimePrefs(next);
    setPrefs(next);
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className={titleClass} data-settings-section="Sounds">{t("Sounds")}</h3>
          <p className={hintClass}>{t("A short chime when a card changes column. Moves you make yourself stay quiet.")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.on}
          aria-label={t("Sounds")}
          onClick={() => update({ ...prefs, on: !prefs.on })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${prefs.on ? "bg-accent" : "bg-line-strong"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-panel shadow transition-[left] ${prefs.on ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
      </div>
      <div className={`flex flex-col gap-2 ${prefs.on ? "" : "opacity-50"}`}>
        <label className="flex items-center gap-3">
          <span className="w-[200px] shrink-0 text-[13px] text-ink">{t("Volume")}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.volume}
            disabled={!prefs.on}
            onChange={(e) => update({ ...prefs, volume: Number(e.target.value) })}
            className="w-[180px] accent-accent"
          />
          <span className="w-8 text-right text-[12px] tabular-nums text-muted">{prefs.volume}</span>
        </label>
        {CHIME_KINDS.map((kind) => (
          <div key={kind} className="flex items-center gap-3">
            <label className="flex w-[200px] shrink-0 items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={prefs.kinds[kind]}
                disabled={!prefs.on}
                onChange={(e) => update({ ...prefs, kinds: { ...prefs.kinds, [kind]: e.target.checked } })}
                className="accent-accent"
              />
              {CHIMES[kind].label}
            </label>
            <span className="min-w-0 flex-1 text-[12.5px] text-muted">{CHIMES[kind].hint}</span>
            <button
              type="button"
              onClick={() => previewChime(kind)}
              className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-sunken"
            >
              {t("Play")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

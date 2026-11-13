"use client";

import { useEffect, useState } from "react";
import { BLUETOOTH, listMics, micId, setMicId } from "@/lib/mic";
import { useUiText } from "@/lib/ui-language";

// Settings → General → Dictation: which microphone the mic button records from (lib/mic.ts).
// "Automatic" is the system input, unless that's Bluetooth: then the first wired or built-in mic.
export default function DictationMicPicker() {
  const t = useUiText();
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [chosen, setChosen] = useState(micId);

  useEffect(() => {
    const load = () => {
      listMics().then(setMics, () => {});
    };
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => navigator.mediaDevices.removeEventListener("devicechange", load);
  }, []);

  return (
    <section className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium text-ink">{t("Microphone")}</h3>
        <p className="text-[12.5px] text-muted">Automatic skips Bluetooth mics, which are slow to open and sound like a phone call.</p>
      </div>
      <select
        aria-label={t("Dictation microphone")}
        value={chosen}
        onChange={(e) => {
          setChosen(e.target.value);
          setMicId(e.target.value);
        }}
        className="max-w-[180px] shrink-0 truncate rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink"
      >
        <option value="">Automatic</option>
        {mics.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {BLUETOOTH.test(m.label) ? " (Bluetooth)" : ""}
          </option>
        ))}
      </select>
    </section>
  );
}

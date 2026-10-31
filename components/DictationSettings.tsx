"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { DICTATION_LANGUAGES } from "@/lib/dictation-languages";
import type { DictationSettingsView } from "@/lib/dictation-types";
import { SettingsSectionHeader } from "./SettingsLayout";
import SwitchRow from "./SwitchRow";

// Settings → General: the mic button's language, your vocabulary, and Advanced dictation, which
// downloads a model and keeps whisper-server warm (lib/whisper-server.ts).

const MB = 1024 * 1024;

// The line under Advanced dictation: the download's progress, what's missing, or the model in use.
export function advancedLine(view: DictationSettingsView): string {
  const { download, model, server, prefs } = view;
  if (download.downloading) {
    const got = Math.round(download.received / MB);
    return download.total ? `Downloading the model: ${got} of ${Math.round(download.total / MB)} MB` : `Downloading the model: ${got} MB`;
  }
  if (download.error) return download.error;
  if (!prefs.advanced) return "";
  if (!server) return "Needs whisper-server: brew install whisper-cpp";
  return model ? `Using ${model}` : "";
}

export default function DictationSettings() {
  const [view, setView] = useState<DictationSettingsView | null>(null);
  const [vocabulary, setVocabulary] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .dictationSettings()
      .then((v) => {
        setView(v);
        setVocabulary(v.prefs.vocabulary);
      })
      .catch(() => {});
  }, []);

  // While the model downloads, the progress line updates once a second.
  const downloading = view?.download.downloading ?? false;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => {
      api.dictationSettings().then(setView).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [downloading]);

  if (!view) return null;
  const change = (patch: { language?: string; advanced?: boolean; vocabulary?: string }) => {
    setError("");
    api
      .setDictationSettings(patch)
      .then(setView)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const line = advancedLine(view);
  return (
    <section className="flex flex-col gap-3">
      <SettingsSectionHeader title="Dictation" hint="The mic button and its shortcut turn speech into text on this Mac with whisper. Nothing you say leaves it." />
      <section className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-ink">Language</h3>
          <p className="text-[12.5px] text-muted">Naming it is a second or two faster than detecting it each time.</p>
        </div>
        <select
          aria-label="Dictation language"
          value={view.prefs.language}
          onChange={(e) => change({ language: e.target.value })}
          className="shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-[12px] text-ink"
        >
          {DICTATION_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </section>
      <section className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-medium text-ink">Vocabulary</h3>
          <p className="text-[12.5px] text-muted">Names and terms whisper should expect, like your projects, tools and people. Comma-separated or one per line.</p>
        </div>
        <textarea
          aria-label="Dictation vocabulary"
          value={vocabulary}
          rows={2}
          maxLength={600}
          placeholder="Weft, Supabase, puku-cli, tsc"
          onChange={(e) => setVocabulary(e.target.value)}
          onBlur={() => vocabulary !== view.prefs.vocabulary && change({ vocabulary })}
          className="w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-[12.5px] text-ink placeholder:text-muted"
        />
      </section>
      <SwitchRow
        title="Advanced dictation"
        hint="Keeps a speech model loaded so text is back in about half a second. Downloads large-v3-turbo (~550 MB) once if this Mac has none, and holds 1-2 GB of memory while you dictate, freed after 5 idle minutes."
        on={view.prefs.advanced}
        onChange={(on) => change({ advanced: on })}
      />
      {line && <p className={`text-[12px] ${view.download.error ? "text-danger" : "text-muted"}`}>{line}</p>}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </section>
  );
}

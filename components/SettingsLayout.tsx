// Small layout helpers for the Settings dialog: a frosted card over the scene, a row's title and
// hint, and the unsaved dot for the page nav.
import type { ReactNode } from "react";
import { SETTINGS_HINT, SETTINGS_TITLE } from "@/lib/settings-shared";

// A setting's title and hint, stacked on the left of its row.
export function SettingsSectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className={SETTINGS_TITLE}>{title}</h3>
      <p className={SETTINGS_HINT}>{hint}</p>
    </div>
  );
}

// A frosted card over the scene, holding one group of settings. The card stops mousedown so
// clicks on it (and its solid background) don't close the dialog as if they were the scene.
export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div
      data-settings-card
      onMouseDown={(e) => e.stopPropagation()}
      className="flex flex-col gap-5 rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl"
    >
      {children}
    </div>
  );
}

// The small accent dot on a page whose edits wait for Save.
export function SettingsUnsavedDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unsaved changes" />;
}

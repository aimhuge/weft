"use client";

// The card every section of Settings → Teams sits in: the same card as the other Settings pages
// (SettingsDialog's Card), with an optional small-caps title and something on its right.
import { type ReactNode } from "react";

const CARD = "wz-board rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
export const SUBTLE = "text-[12.5px] text-muted";
export const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken";

export function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section data-settings-card className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      {title || aside ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <h4 className={SECTION_TITLE}>{title}</h4> : <span />}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

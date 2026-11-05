"use client";

// The open Settings page's own top nav: one chip per section drawn on it, stuck to the top of the page as it scrolls,
// the chip of the section in view lit. A click scrolls that section's card up under the nav and flashes it.
// Pages with one section or none (Shortcuts, Teams) get no row at all, so it never costs space for nothing.

import type { Ref } from "react";
import type { SettingsSection } from "@/lib/settings-search";

export default function SettingsSectionNav({
  sections,
  active,
  onJump,
  navRef,
}: {
  sections: SettingsSection[];
  active: string | null;
  onJump: (title: string) => void;
  navRef: Ref<HTMLElement>;
}) {
  return (
    <nav
      ref={navRef}
      aria-label="Sections on this page"
      onMouseDown={(e) => e.stopPropagation()}
      // Always mounted (the hook measures its edge), but drawn only with two or more sections.
      hidden={sections.length < 2}
      className="sticky top-0 z-10 -mb-1 flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-line-strong bg-panel/85 p-1.5 shadow-lg backdrop-blur-xl [scrollbar-width:none]"
    >
      {sections.map((s) => {
        const on = s.title === active;
        return (
          <button
            key={s.title}
            type="button"
            aria-current={on ? "location" : undefined}
            onClick={() => onJump(s.title)}
            className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] ${
              on ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink"
            }`}
          >
            {s.title}
          </button>
        );
      })}
    </nav>
  );
}

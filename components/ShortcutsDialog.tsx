"use client";

import { useState } from "react";
import { filterSections, splitDescription } from "@/lib/shortcut-catalog";
import Icon from "./Icon";
import KeyCaps, { Cap } from "./KeyCaps";
import Modal from "./Modal";
import { PrintSheetButton } from "./PrintShortcutSheet";
import { useShortcutSections } from "./use-shortcut-sections";

// Every shortcut in the app, searchable by what it does or by its keys ("archive", "cmd k", "esc").
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { sections, mac } = useShortcutSections();
  const [query, setQuery] = useState("");
  const shown = filterSections(sections, query, mac);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const holdKey = mac ? "⌘" : "Ctrl";

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} placement="top" className="max-h-[84vh] w-[94vw] max-w-[1100px]">
      <div className="relative shrink-0 border-b border-line px-6 py-3">
        <Icon name="search" size={16} className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={`Search ${total} shortcuts: archive, ${mac ? "cmd" : "ctrl"} k, esc…`}
          aria-label="Search shortcuts"
          className="w-full rounded-lg border border-line-strong bg-canvas py-2.5 pl-10 pr-3 text-[15px] text-ink outline-none placeholder:text-faint focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-muted">No shortcut matches “{query.trim()}”</p>
        ) : (
          <div className="gap-x-12 md:columns-2">
            {shown.map(({ group, items }) => (
              <section key={group} className="mb-7 break-inside-avoid">
                <h3 className="mb-2 border-b border-line-strong pb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-accent">
                  {group}
                </h3>
                <ul className="flex flex-col">
                  {items.map((s) => {
                    const { main, detail } = splitDescription(s.description);
                    return (
                      <li
                        key={s.id}
                        className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2.5 hover:bg-sunken"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[15px] leading-snug text-ink">{main}</span>
                          {detail && <span className="mt-0.5 text-[12.5px] leading-snug text-muted">{detail}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {s.keys.map((spec, i) => (
                            <span key={spec} className="flex items-center gap-1.5">
                              {i > 0 && <span className="text-[12px] text-faint">or</span>}
                              <KeyCaps spec={spec} large />
                            </span>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-line px-6 py-3 text-[13px] text-muted">
        <p className="min-w-0 flex-1">
          Hold <Cap small>{holdKey}</Cap> or <Cap small>{mac ? "⇧" : "Shift"}</Cap> on the board to see what they do · plain
          keys pause while you type · change the dictation key in Settings
        </p>
        <PrintSheetButton sections={sections} mac={mac} />
      </div>
    </Modal>
  );
}

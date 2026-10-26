"use client";

import { useEffect, useState } from "react";
import { printerNames, printHtml } from "@/lib/print-sheet";
import type { ShortcutSection } from "@/lib/shortcut-catalog";
import { shortcutSheetHtml } from "@/lib/shortcut-sheet";
import Icon from "./Icon";
import { Cap } from "./KeyCaps";
import { useShortcutSections } from "./use-shortcut-sections";

// The shortcut sheet on paper (lib/shortcut-sheet.ts): a Print button the "?" dialog always has (with no printer the
// print dialog still saves a PDF), and a short pitch on the welcome's last screen, shown only when this Mac has a printer.

const print = (sections: ShortcutSection[], mac: boolean) => void printHtml(shortcutSheetHtml(sections, mac));

export function PrintSheetButton({ sections, mac }: { sections: ShortcutSection[]; mac: boolean }) {
  return (
    <button
      type="button"
      onClick={() => print(sections, mac)}
      title="Print every shortcut on one page"
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
    >
      <Icon name="printer" size={14} /> Print
    </button>
  );
}

// True once main says this Mac has at least one printer; false on the web and while it's asking.
export function useHasPrinter() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let live = true;
    void printerNames().then((names) => live && setHas(names.length > 0));
    return () => {
      live = false;
    };
  }, []);
  return has;
}

export function PrintSheetOffer() {
  const has = useHasPrinter();
  const { sections, mac } = useShortcutSections();
  if (!has) return null;
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-accent-soft/40 px-3 py-2 text-[11.5px] text-muted">
      <span className="text-[18px]" aria-hidden>
        ⌨️
      </span>
      <p className="min-w-0 flex-1 leading-relaxed">
        <b className="text-ink">Weft is quickest from the keyboard.</b> <Cap small>N</Cap> starts a thread, <Cap small>J</Cap>{" "}
        <Cap small>K</Cap> move between cards, <Cap small>A</Cap> jumps to the one that needs you. All {total} shortcuts
        fit on one page to keep by your screen.
      </p>
      <button
        type="button"
        onClick={() => print(sections, mac)}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
      >
        <Icon name="printer" size={14} /> Print the sheet
      </button>
    </div>
  );
}

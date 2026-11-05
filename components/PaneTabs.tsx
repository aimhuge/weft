"use client";

import type { PaneTab } from "@/lib/client";
import { pageLabel } from "@/lib/show-rail";
import Icon from "./Icon";

// The toolbar's + : a blank tab in the open card's browser. A shell from before tabs has no newTab, so no button.
export function NewTabButton({ className, onOpen }: { className: string; onOpen: () => void }) {
  const browser = typeof window === "undefined" ? undefined : window.weft?.browser;
  if (!browser?.newTab) return null;
  return (
    <button
      className={className}
      onClick={() => {
        browser.newTab?.();
        onOpen();
      }}
      aria-label="New tab"
      title="New tab"
    >
      <Icon name="plus" size={15} />
    </button>
  );
}

// What a tab says: the page's title, else a short name for its url, else "New tab" for a blank one.
export function tabLabel(tab: PaneTab) {
  return tab.title.trim() || (tab.url ? pageLabel(tab.url) : "New tab");
}

// The open card's browser tabs, under the toolbar (components/BrowserPane.tsx). Only drawn with two or
// more tabs: a card with one page keeps the row for the page. Middle-click or × closes a tab.
export default function PaneTabs({ tabs = [], current }: { tabs?: readonly PaneTab[]; current: number | null | undefined }) {
  if (tabs.length < 2) return null;
  const browser = typeof window === "undefined" ? undefined : window.weft?.browser;
  return (
    <div role="tablist" aria-label="Browser tabs" className="flex gap-0.5 overflow-x-auto border-b border-line bg-sunken px-1.5 pt-1">
      {tabs.map((tab) => {
        const on = tab.id === current;
        const label = tabLabel(tab);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={on}
            title={tab.url || label}
            onClick={() => browser?.selectTab?.(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) browser?.closeTab?.(tab.id);
            }}
            className={`group flex min-w-0 max-w-[160px] flex-1 cursor-default items-center gap-1 rounded-t-md py-1 pl-2.5 pr-1 text-[12px] ${on ? "bg-panel text-ink" : "text-muted hover:bg-panel/60 hover:text-ink"}`}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <button
              aria-label={`Close ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                browser?.closeTab?.(tab.id);
              }}
              className={`shrink-0 rounded p-0.5 text-faint hover:bg-sunken hover:text-ink ${on ? "" : "opacity-0 group-hover:opacity-100"}`}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

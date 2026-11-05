"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

type Found = { active: number; matches: number };

// Find in page for the browser pane: ⌘F on the page swaps the toolbar's address bar for this field, and
// Chromium highlights the matches (electron/pane-find.cjs). Typing searches; Enter and ⇧Enter (or ⌘G and
// ⇧⌘G) step through the matches; Escape or ✕ closes it and clears the highlights.
export default function PaneFindBar({ url, focus, onClose }: { url: string; focus: number; onClose: () => void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // What's in the field, for the effect that searches a new page again.
  const latest = useRef("");

  useEffect(() => window.weft?.browser.onFound?.(setFound), []);
  // ⌘F again while it's open puts the cursor back in the field, with the word selected.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focus]);
  // A new page has new matches: search it again, and the shell sends the new count.
  useEffect(() => {
    if (latest.current) window.weft?.browser.find?.(latest.current);
  }, [url]);

  function search(next: string) {
    setText(next);
    latest.current = next;
    if (!next) setFound(null);
    window.weft?.browser.find?.(next);
  }
  function step(forward: boolean) {
    if (text) window.weft?.browser.find?.(text, { forward, next: true });
  }
  function close() {
    window.weft?.browser.stopFind?.();
    onClose();
  }

  const nav = "rounded-md p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  const none = Boolean(text) && found?.matches === 0;
  return (
    <div className="mx-1 flex min-w-0 flex-1 items-center gap-0.5">
      <div className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-canvas px-2 ${none ? "border-red-400" : "border-accent"}`}>
        <Icon name="search" size={13} className="shrink-0 text-faint" />
        <input
          ref={input}
          value={text}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            const mod = e.metaKey || e.ctrlKey;
            const g = mod && e.key.toLowerCase() === "g";
            if (mod && e.key.toLowerCase() === "f") {
              // ⌘F here stays in the find bar rather than jumping to the board's card filter.
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.select();
            } else if (e.key === "Enter" || g) {
              e.preventDefault();
              step(!e.shiftKey);
            } else if (e.key === "Escape") {
              // Ahead of the board's own Escape, which would close the card.
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          placeholder="Find in page"
          aria-label="Find in page"
          className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-ink outline-none placeholder:text-faint"
        />
        {text && found && (
          <span className="shrink-0 text-[11px] tabular-nums text-faint" aria-live="polite">
            {found.matches === 0 ? "No matches" : `${found.active}/${found.matches}`}
          </span>
        )}
      </div>
      <button className={nav} disabled={!found?.matches} onClick={() => step(false)} aria-label="Previous match">
        <Icon name="chevronUp" size={14} />
      </button>
      <button className={nav} disabled={!found?.matches} onClick={() => step(true)} aria-label="Next match">
        <Icon name="chevronDown" size={14} />
      </button>
      <button className={nav} onClick={close} aria-label="Close find">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

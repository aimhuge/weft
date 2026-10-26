"use client";

// A list-view row's folder cell: the folder the card runs in, and how many other cards share it. A click
// opens a type-ahead picker of every folder on the board (lib/list-actions.ts knownFolders): type part of a
// name or path, ↑↓ and Enter to move the card there, or Choose folder… for the system's own dialog. A path
// you type in full can be used as it is.
import { useState } from "react";
import { folderName } from "@/lib/format";
import { stepHighlight, typeahead } from "@aimhuge/sheet";
import type { Card } from "@/lib/types";
import { PopSearch, SheetPopover } from "@aimhuge/sheet/client";

export interface RowFolderCellProps {
  card: Card;
  alsoHere: Card[];
  folders?: string[];
  onFolder?: (cwd: string) => void;
}

export default function RowFolderCell({ card, alsoHere, folders = [], onFolder }: RowFolderCellProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const movable = Boolean(onFolder) && card.role !== "copilot";
  const name = card.role === "copilot" ? "whole board" : folderName(card.cwd);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      {movable ? (
        <button
          title={`${card.cwd}\nClick to move this card to another folder`}
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(e.currentTarget.getBoundingClientRect());
          }}
          className="sheet-link min-w-0 truncate text-muted"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate text-muted" title={card.cwd}>
          {name}
        </span>
      )}
      {alsoHere.length > 0 && (
        <span className="shrink-0 font-medium text-warn" title={`Also running in this folder (shared working tree):\n${alsoHere.map((c) => c.title).join("\n")}`}>
          +{alsoHere.length}
        </span>
      )}
      {anchor && onFolder && (
        <FolderPicker
          anchor={anchor}
          current={card.cwd}
          folders={folders}
          onPick={(cwd) => {
            setAnchor(null);
            if (cwd !== card.cwd) onFolder(cwd);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </span>
  );
}

export function FolderPicker({ anchor, current, folders, onPick, onClose }: { anchor: DOMRect; current: string; folders: string[]; onPick: (cwd: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [at, setAt] = useState(0);
  const typed = /^[~/]/.test(search.trim()) ? search.trim() : null;
  const shown = typeahead(folders, search, (f) => f).slice(0, 40);
  const bridge = typeof window === "undefined" ? undefined : window.weft;

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt(stepHighlight(at, shown.length, e.key));
    } else if (e.key === "Enter") {
      const pick = shown[at] ?? typed;
      if (pick) onPick(pick);
    }
  }

  return (
    <SheetPopover anchor={anchor} width={340} label="Move to folder" onClose={onClose}>
      <PopSearch
        value={search}
        placeholder="Type a folder name or path…"
        onChange={(text) => {
          setSearch(text);
          setAt(0);
        }}
        onKeyDown={onKey}
      />
      <div className="max-h-[300px] overflow-y-auto px-1 pb-1" role="listbox" aria-label="Folders">
        {shown.map((path, i) => (
          <div
            key={path}
            role="option"
            aria-selected={i === at}
            onMouseEnter={() => setAt(i)}
            onClick={() => onPick(path)}
            className={`flex cursor-pointer flex-col rounded-md px-2.5 py-1.5 ${i === at ? "bg-accent-soft" : ""}`}
          >
            <span className="flex items-center gap-2 text-[12px] font-medium">
              {folderName(path)}
              {path === current && <span className="text-[10px] font-normal text-faint">current</span>}
            </span>
            <span className="truncate text-[10.5px] text-faint">{path}</span>
          </div>
        ))}
        {typed && !shown.includes(typed) && (
          <button onClick={() => onPick(typed)} className="w-full rounded-md px-2.5 py-1.5 text-left hover:bg-sunken">
            Use <code className="text-accent">{typed}</code>
          </button>
        )}
        {!shown.length && !typed && <div className="px-2 py-3 text-center text-faint">No folder matches “{search}”</div>}
      </div>
      {bridge && (
        <button
          onClick={() => void bridge.dialog.openFolder().then((picked) => picked && onPick(picked))}
          className="sheet-pop-foot px-3 py-2 text-left text-[11px] text-accent hover:bg-sunken"
        >
          Choose folder…
        </button>
      )}
    </SheetPopover>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filesApi } from "@/lib/client-files";
import Modal from "./Modal";

// ⌘P: a fuzzy file picker over the card's folder, opened from the editor column. Keyboard-driven:
// typing filters, ↑/↓ move, Enter opens the highlighted file, Escape closes. The list is kept
// short and ordered by where the match landed (filename > basename > path) so the obvious file
// is usually first.

interface QuickOpenProps {
  cardId: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

interface Scored {
  path: string;
  rank: number;
}

// Match a query against a path, returning a rank. Lower is better. Filename hits outrank
// basename-only hits which outrank folder-name hits, and the position of the first character
// in the filename is a tie-breaker.
function score(query: string, path: string): number | null {
  if (!query) return 0;
  const file = path.split("/").pop() ?? path;
  const q = query.toLowerCase();
  const f = file.toLowerCase();
  const idx = f.indexOf(q);
  if (idx >= 0) return idx;
  if (path.toLowerCase().includes(q)) return 100 + path.toLowerCase().indexOf(q);
  // Subsequence match (typing "tbx" finds "types/board.tsx"): every char of q appears in f, in order.
  let i = 0;
  for (const ch of f) {
    if (ch === q[i]) i++;
    if (i === q.length) return 200;
  }
  return null;
}

export default function QuickOpen({ cardId, onPick, onClose }: QuickOpenProps) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);


  useEffect(() => {
    let cancelled = false;
    filesApi.list(cardId).then(
      (list) => !cancelled && setFiles(list),
      () => !cancelled && setFiles([]),
    );
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo<Scored[]>(() => {
    if (!files) return [];
    const scored: Scored[] = [];
    for (const path of files) {
      const r = score(query.trim(), path);
      if (r !== null) scored.push({ path, rank: r });
    }
    scored.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
    return scored.slice(0, 50);
  }, [files, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${Math.min(active, Math.max(0, results.length - 1))}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  function pick(path: string) {
    onPick(path);
    onClose();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const last = results.length - 1;
    if (e.key === "ArrowDown") setActive((a) => (a >= last ? 0 : a + 1));
    else if (e.key === "ArrowUp") setActive((a) => (a <= 0 ? last : a - 1));
    else if (e.key === "Enter") {
      const r = results[Math.min(active, Math.max(0, last))];
      if (r) pick(r.path);
    }
  }

  return (
    <Modal label="Open file" onClose={onClose} placement="top" className="w-full max-w-[520px] overflow-hidden">
      <div onKeyDown={onKey}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Type to search files…"
          className="w-full border-b border-line bg-panel px-3 py-2.5 text-[13.5px] text-ink placeholder:text-faint outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <ul ref={listRef} className="max-h-[40vh] overflow-y-auto py-1 text-[13px]">
          {files === null && <li className="px-3 py-1.5 text-faint">Loading…</li>}
          {files !== null && results.length === 0 && <li className="px-3 py-1.5 text-faint">{query ? "No matches" : "No files"}</li>}
          {results.map((r, i) => (
            <li
              key={r.path}
              data-index={i}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r.path);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === active ? "bg-accent-soft text-ink" : "text-ink"}`}
            >
              <span className="truncate font-medium">{r.path.split("/").pop()}</span>
              <span className="truncate text-faint">{r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/") + 1) : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

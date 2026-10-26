"use client";

// The list view's quick add: a row at the foot of the Backlog and Running bands that you just type into,
// the way you'd type a new row into a sheet. In the Backlog, Enter files a card with that title and nothing
// starts; the box clears and keeps the cursor, so a list of ideas goes in one line after another. In
// Running, Enter starts a thread on what you typed. The folder chip says where it goes (the most recently
// busy folder on the sheet, so it follows the project filter) and changes it; More… opens New thread.
import { useState } from "react";
import { api } from "@/lib/client";
import { folderName } from "@/lib/format";
import type { Backend, Column } from "@/lib/types";
import { FolderPicker } from "./RowFolderCell";

// Settings' default CLI, read once on the first add.
let backend: Promise<Backend> | null = null;
function defaultBackend() {
  backend ??= api.settings().then(
    (s) => s.defaultBackend,
    () => "claude" as const,
  );
  return backend;
}

export interface SheetQuickAddProps {
  column: Extract<Column, "backlog" | "running">;
  folders: string[];
  focus: boolean;
  onMore: () => void;
  notify?: (err: unknown) => void;
}

export default function SheetQuickAdd({ column, folders, focus, onMore, notify }: SheetQuickAddProps) {
  const [text, setText] = useState("");
  const [cwd, setCwd] = useState<string | null>(null);
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const [added, setAdded] = useState(0);
  const folder = cwd ?? folders[0];
  const backlog = column === "backlog";

  async function add() {
    const words = text.trim();
    if (!words || !folder) return;
    setText("");
    try {
      const input = backlog ? { title: words, prompt: words, start: false } : { prompt: words, start: true };
      await api.create({ ...input, cwd: folder, backend: await defaultBackend() });
      setAdded((n) => n + 1);
    } catch (err) {
      setText(words);
      notify?.(err);
    }
  }

  return (
    <div className="sheet-row sheet-add flex">
      <span className="sheet-gutter text-accent" aria-hidden>
        +
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
        <input
          autoFocus={focus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          aria-label={backlog ? "New Backlog card title" : "Start a thread"}
          placeholder={backlog ? "Add to the Backlog: type a title, Enter  (Space B from anywhere)" : "Start a thread: say what to do, Enter  (Space R)"}
          className="sheet-add-input min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
        {added > 0 && !text && <span className="shrink-0 text-[11px] text-ok">✓ {added} added</span>}
        {folder && (
          <button
            title={`Goes in ${folder}. Click to pick another folder`}
            onClick={(e) => setPicking(e.currentTarget.getBoundingClientRect())}
            className="sheet-add-chip shrink-0"
          >
            {folderName(folder)}
          </button>
        )}
        <button onClick={onMore} title="New thread, with every option" className="shrink-0 text-[11px] text-faint hover:text-accent">
          More…
        </button>
      </div>
      {picking && (
        <FolderPicker
          anchor={picking}
          current={folder ?? ""}
          folders={folders}
          onPick={(path) => {
            setCwd(path);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

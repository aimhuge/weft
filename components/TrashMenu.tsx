"use client";

import { useState } from "react";
import { folderName, timeAgo } from "@/lib/format";
import { trashApi, type TrashItem } from "@/lib/trash-client";
import { useEscape } from "@/lib/use-escape";
import Icon from "./Icon";
import Tip from "./Tip";

// Recently deleted, from the Done column's header (docs/architecture/card-trash.md): a small icon there, no row of
// its own. It loads the list when it opens; Restore puts a card back, and the board hears of it over the event
// stream like any new card, so the list only drops the row.
export default function TrashMenu() {
  const [open, setOpen] = useState(false);
  // null while the list loads.
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When it opened, for each row's "deleted 2h ago".
  const [now, setNow] = useState(0);
  const close = () => setOpen(false);
  useEscape(open, close);
  const show = (err: unknown) => setError(err instanceof Error ? err.message : String(err));
  function toggle() {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setNow(Date.now());
    setItems(null);
    setError(null);
    trashApi.list().then(setItems, show);
  }
  function restore(id: string) {
    trashApi.restore(id).then(() => setItems((list) => list && list.filter((i) => i.id !== id)), show);
  }
  return (
    <>
      <Tip text="Recently deleted: cards deleted in the last 30 days, to restore" className="inline-flex">
        <button onClick={toggle} aria-expanded={open} aria-label="Recently deleted" className="rounded p-0.5 text-faint hover:bg-hover hover:text-ink @max-[230px]:hidden">
          <Icon name="trash" size={12} />
        </button>
      </Tip>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={close} aria-hidden="true" />
          <div role="menu" aria-label="Recently deleted" className="absolute inset-x-2 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-line-strong bg-panel p-1.5 shadow-xl">
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">Recently deleted</div>
            {error && <p className="px-2 pb-1.5 text-[12px] leading-snug text-danger">{error}</p>}
            {!error && statusLine(items) && <p className="px-2 pb-1.5 text-[12px] leading-snug text-muted">{statusLine(items)}</p>}
            {items?.map((item) => <TrashRow key={item.id} item={item} now={now} onRestore={() => restore(item.id)} />)}
          </div>
        </>
      )}
    </>
  );
}

// What the list says when it has no rows to show.
function statusLine(items: TrashItem[] | null): string | null {
  if (items === null) return "Loading…";
  return items.length === 0 ? "Nothing deleted in the last 30 days." : null;
}

function TrashRow({ item, now, onRestore }: { item: TrashItem; now: number; onRestore: () => void }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-hover">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink">{item.title}</div>
        <div className="truncate text-[11px] text-faint">
          {folderName(item.cwd)} · deleted {timeAgo(item.deletedAt, now)}
        </div>
      </div>
      <button onClick={onRestore} aria-label={`Restore ${item.title}`} className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-accent hover:bg-sunken">
        Restore
      </button>
    </div>
  );
}

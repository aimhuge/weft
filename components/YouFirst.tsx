"use client";

import { useThreadTransport } from "@/lib/thread-transport";
import { useWaitersOn } from "@/lib/waits-on";
import CardFace from "./CardFace";

// The holder's side of a claim clash: a card waiting on this thread's code (lib/permission-wait.ts) shows here
// with You first, which puts it ahead (lib/precedence.ts): its edit goes ahead and this thread is told to leave
// the file to it. Nothing shows while no one waits, or where the transport can't (weft.zip).
export default function YouFirst({ cardId }: { cardId: string }) {
  const waiters = useWaitersOn(cardId);
  const { putFirst } = useThreadTransport();
  if (!waiters.length || !putFirst) return null;
  return (
    <div data-human-only className="flex shrink-0 flex-col gap-1 border-t border-warn/40 bg-warn-soft px-4 py-1.5">
      {waiters.map((w) => (
        <div key={w.pendingId} className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <CardFace face={w} tip={`‘${w.title}’ is waiting on this thread`} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-ink">‘{w.title}’</span> waits on this thread for <span className="font-mono text-ink">{w.file}</span>
          </span>
          <button
            onClick={() => void putFirst(w.id, w.pendingId).catch(() => {})}
            title={`Let ‘${w.title}’ go first: its edit goes ahead, and this thread leaves ${w.file} to it until it commits or finishes`}
            className="shrink-0 rounded-md border border-line-strong bg-panel px-2 py-0.5 text-[12px] text-ink hover:bg-sunken"
          >
            You first
          </button>
        </div>
      ))}
    </div>
  );
}

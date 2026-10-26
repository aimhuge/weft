"use client";

import { sendsWhen } from "@/lib/schedule";
import type { ScheduledMessage } from "@/lib/types";
import Icon from "./Icon";

const ROW = "flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-muted";

// What waits above a thread's reply box: messages scheduled for later (the server sends them, even with
// the thread closed) and replies queued behind the running turn.
export function ReplyQueue({
  scheduled,
  queue,
  paused,
  live,
  sending,
  now,
  onTakeBack,
  onUnschedule,
  onSendNow,
  onRemove,
}: {
  scheduled: ScheduledMessage[];
  queue: string[];
  // Held while you edit a message pulled back out of the queue.
  paused: boolean;
  live: boolean;
  sending: boolean;
  now: number;
  onTakeBack: (m: ScheduledMessage) => void;
  onUnschedule: (messageId: string) => void;
  onSendNow: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  if (!queue.length && !scheduled.length) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {scheduled.map((m) => (
        <li
          key={m.id}
          className={ROW}
          title={
            m.afterRestart
              ? "Sent while Weft waits to restart; it goes out once Weft is back"
              : m.forSlot
                ? "Waiting for a free slot: it goes out when a running thread finishes its turn"
                : m.afterTurn
                  ? "Sent while the thread was busy; it goes out as this turn ends"
                  : `Sends ${new Date(m.at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}, even if this thread is closed`
          }
        >
          <Icon name={m.afterRestart || m.afterTurn || m.forSlot ? "reload" : "clock"} size={11} className="shrink-0" />
          <span className="shrink-0 font-mono text-[11px]">{sendsWhen(m, now)}</span>
          <button
            type="button"
            onClick={() => onTakeBack(m)}
            title="Take it back to edit"
            className="min-w-0 flex-1 truncate text-left hover:text-ink"
          >
            {m.text}
          </button>
          <button type="button" onClick={() => onUnschedule(m.id)} aria-label="Cancel scheduled message" className="shrink-0 hover:text-ink">
            <Icon name="x" size={12} />
          </button>
        </li>
      ))}
      {queue.map((text, i) => (
        <li key={i} className={ROW}>
          <span className="shrink-0 text-[11px] uppercase tracking-wide">{paused ? "Paused" : "Queued"}</span>
          <span className="min-w-0 flex-1 truncate">{text}</span>
          <button
            type="button"
            onClick={() => onSendNow(i)}
            disabled={sending}
            title={live ? "Stop the current turn and send this now" : "Send this now"}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-ink hover:bg-line disabled:opacity-40"
          >
            Send now
          </button>
          <button type="button" onClick={() => onRemove(i)} aria-label="Remove queued message" className="shrink-0 hover:text-ink">
            <Icon name="x" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

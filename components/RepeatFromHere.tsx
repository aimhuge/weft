"use client";

import { repeatFrom } from "@/lib/cron-events";
import { useThreadTransport } from "@/lib/thread-transport";
import Icon from "./Icon";

// The ⏰ in the gutter of one of your messages, shown on hover: put the thread on a cron from this message
// (docs/architecture/crons.md). Only on the Mac, and only for a message its session can be forked at.
export default function RepeatFromHere({ cardId, id, text }: { cardId: string; id?: string; text: string }) {
  const { desktop } = useThreadTransport();
  if (!desktop || !id) return null;
  return (
    <button
      type="button"
      onClick={() => repeatFrom(cardId, { id, text })}
      title="Repeat from here on a cron"
      aria-label="Repeat from here on a cron"
      className="absolute -left-8 top-1.5 rounded-md p-1 text-faint opacity-0 transition-opacity hover:bg-sunken hover:text-[var(--cron,#7a5af5)] focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Icon name="clock" size={14} />
    </button>
  );
}

"use client";

import { lastSent } from "@/lib/edit-last";
import { cardCan } from "@/lib/project-host";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card, ThreadItem } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import CronButton from "./CronButton";

// The thread header's ⏰ (components/ThreadPanel.tsx), anchored on the thread's last message. Left out for the
// copilot, on weft.zip and on a card whose host has no crons (a worker's: lib/project-host.ts cardCan "cron").
export default function ThreadCronButton({ card, items }: { card: Card; items: readonly (ThreadItem | null | undefined)[] }) {
  const now = useNow();
  const transport = useThreadTransport();
  if (!cardCan(card, transport, "cron") || card.role === "copilot") return null;
  const last = lastSent(items);
  return <CronButton card={card} last={last ? { id: last.promptId, text: last.text } : undefined} now={now} />;
}

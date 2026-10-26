"use client";

import { lastSent } from "@/lib/edit-last";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card, ThreadItem } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import CronButton from "./CronButton";

// The thread header's ⏰ (components/ThreadPanel.tsx), anchored on the thread's last message. Left out for the
// copilot and on weft.zip, where crons can't run.
export default function ThreadCronButton({ card, items }: { card: Card; items: readonly (ThreadItem | null | undefined)[] }) {
  const now = useNow();
  const { desktop } = useThreadTransport();
  if (!desktop || card.role === "copilot") return null;
  const last = lastSent(items);
  return <CronButton card={card} last={last ? { id: last.promptId, text: last.text } : undefined} now={now} />;
}

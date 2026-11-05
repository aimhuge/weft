"use client";

import { lastSent } from "@/lib/edit-last";
import { cardCan, hostOf } from "@/lib/project-host";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Card, ThreadItem } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import CronButton, { type MakeCron } from "./CronButton";

// The thread header's ⏰ (components/ThreadPanel.tsx), anchored on the thread's last message. Left out for the
// copilot, on weft.zip and on a card whose host has no crons (lib/project-host.ts cardCan "cron"). A new cron goes to
// the card's host as cron.create: this Mac's POST /api/crons, or a Weft Worker's own cron list, where it fires.
export default function ThreadCronButton({ card, items }: { card: Card; items: readonly (ThreadItem | null | undefined)[] }) {
  const now = useNow();
  const transport = useThreadTransport();
  if (!cardCan(card, transport, "cron") || card.role === "copilot") return null;
  const last = lastSent(items);
  // Only what the popover asks: the host reads the card's folder, CLI and mode itself.
  const make: MakeCron = ({ prompt, expr, name, mode, fromMessage, enabled, startsAt, endsAt, runNow }, local) => {
    const asked = Object.fromEntries(Object.entries({ name, mode, fromMessage, enabled, startsAt, endsAt, runNow }).filter(([, v]) => v !== undefined));
    return hostOf(card).act("cron.create", { id: card.id, prompt, expr, ...asked }, local);
  };
  return <CronButton card={card} last={last ? { id: last.promptId, text: last.text } : undefined} now={now} make={make} />;
}

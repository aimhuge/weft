import type { Card } from "@/lib/types";
import "./crons.css";

// A cron's run on the board (docs/architecture/crons.md): a violet ticket-stub edge, and a violet ⏰ with its run
// number before the title. Other cards draw nothing here.
export function cronCardClass(card: Pick<Card, "cronId">): string {
  return card.cronId ? "cron-stub" : "";
}

export default function CronMark({ card }: { card: Pick<Card, "cronId" | "cronRun"> }) {
  if (!card.cronId) return null;
  return (
    <span className="mr-1 inline-flex items-center gap-1 align-[1px]">
      <span className="text-cron" aria-hidden>⏰</span>
      {card.cronRun !== undefined && <span className="rounded bg-cron-soft px-1 text-[10.5px] font-semibold text-cron">run {card.cronRun}</span>}
    </span>
  );
}

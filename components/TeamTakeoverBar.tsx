"use client";

// Where the reply box would be on a teammate's card (lib/team-host.ts): whose Mac runs it, and the two ways to take it
// over. Ask Zulker leaves an ask their Mac shows them (lib/handover.ts); once they hand it over, your Mac starts your
// card from the branch they pushed, on its own. Take over now doesn't wait: a new card of yours from their thread and
// what they've pushed already (lib/team-takeover.ts), and it opens. Their card stays theirs either way.
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { openCardById } from "@/lib/open-card";
import type { Card, TeamMark } from "@/lib/types";

async function post(mark: Pick<TeamMark, "org">, cardId: string, ask: boolean): Promise<{ card?: Card; id?: string }> {
  const res = await apiFetch("/api/team-board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ org: mark.org, card: cardId, ...(ask ? { ask: true } : {}) }) });
  const body = (await res.json().catch(() => ({}))) as { card?: Card; id?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? (ask ? "Couldn't ask for that card." : "Couldn't take that card over."));
  return body;
}

export async function takeOver(mark: Pick<TeamMark, "org">, cardId: string): Promise<Card> {
  const { card } = await post(mark, cardId, false);
  if (!card) throw new Error("Couldn't take that card over.");
  return card;
}

export const askFor = (mark: Pick<TeamMark, "org">, cardId: string) => post(mark, cardId, true);

const first = (name: string) => name.trim().split(/\s+/)[0] || "your teammate";

// What the bar says, from the card's marks: who took it, or where your ask stands.
export function teamBarText(mark: TeamMark): string {
  const who = first(mark.name);
  if (mark.takenOver) return `${mark.takenOver.name} took this over from ${mark.name}.`;
  switch (mark.handover?.status) {
    case "asked":
      return `Asked ${who}. Your card starts from their work as soon as they hand it over.`;
    case "pushing":
      return `${who} said yes: their Mac is pushing the card's work…`;
    case "pushed":
    case "taken":
      return `${who} handed it over on ${mark.handover.branch ?? "a branch"}. Starting your card…`;
    case "declined":
      return `${who} said not now. You can still take it over from what they've pushed.`;
    case "failed":
    case "cancelled":
      return mark.handover.note ?? `The handover didn't go through. You can still take it over from what ${who} has pushed.`;
    default:
      return `This runs on ${who}'s Mac. Ask them to hand it over with their latest work, or take it over now from what they've pushed.`;
  }
}

// Whether asking makes sense now: not while an ask is under way.
const canAsk = (mark: TeamMark) => !mark.handover || ["declined", "failed", "cancelled"].includes(mark.handover.status);

export default function TeamTakeoverBar({ card }: { card: Card & { team: TeamMark } }) {
  const [busy, setBusy] = useState<"ask" | "take" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handing = card.team.handover?.status === "pushing" || card.team.handover?.status === "pushed" || card.team.handover?.status === "taken";
  async function go(how: "ask" | "take") {
    setBusy(how);
    setError(null);
    try {
      if (how === "take") openCardById((await takeOver(card.team, card.id)).id);
      else await askFor(card.team, card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(null);
  }
  const button = "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-60";
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 text-[12.5px] text-faint">
      <p className="min-w-0 flex-1" role={error ? "alert" : undefined}>
        {error ?? teamBarText(card.team)}
      </p>
      {canAsk(card.team) && (
        <button
          type="button"
          onClick={() => void go("ask")}
          disabled={busy !== null}
          title="Their Mac asks them; if they say yes, it pushes the card's work to a branch and your card starts from it."
          className={`${button} bg-accent text-on-accent hover:opacity-90`}
        >
          {busy === "ask" ? "Asking…" : `Ask ${first(card.team.name)}`}
        </button>
      )}
      {!handing && (
        <button
          type="button"
          onClick={() => void go("take")}
          disabled={busy !== null}
          title="A new card of yours now, from their thread and what they've pushed. Their card stays theirs."
          className={`${button} border border-line text-ink hover:bg-sunken`}
        >
          {busy === "take" ? "Taking over…" : "Take over now"}
        </button>
      )}
    </div>
  );
}

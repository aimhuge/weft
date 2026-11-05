"use client";

// Whose a teammate's card is (lib/team-host.ts), folded into chrome the tile already has: their picture pinned to the
// corner of the card's own picture (TeamCardPicture), and "Zulker's Mac" where the tile's buttons would be (it has
// none: it's read-only). The pane header shows both together (TeamOwnerMark with its avatar). A card a teammate took
// over (lib/team-takeover.ts) says who has it now, on their original and on yours (TakenOverMark).
import type { Card, TakeoverMark, TeamMark } from "@/lib/types";
import { teamMacLabel } from "@/lib/team-board-types";
import CardPicture from "./CardPicture";

const ownerTitle = (mark: TeamMark) =>
  mark.takenOver ? `${mark.name}'s thread. ${mark.takenOver.name} took it over and carries it on on their Mac.` : `${mark.name}'s thread, running on their Mac. Read-only here.`;

// "Alex has it": a card someone continued on their own Mac.
export const takenLabel = (taken: TakeoverMark) => `${taken.name.trim().split(/\s+/)[0] || "A teammate"} has it`;

// On your own card's tile, while a teammate asks for it (lib/handover.ts): open the card to answer.
export function HandoverAskMark({ name }: { name: string }) {
  return (
    <span className="mr-1 truncate rounded bg-accent/15 px-1.5 text-[11px] font-medium text-accent" title={`${name} asks to take this card over. Open it to answer.`}>
      {name.trim().split(/\s+/)[0] || "A teammate"} asks for it
    </span>
  );
}

// On your own card's tile, when a teammate took it over: who carries it on now.
export function TakenOverMark({ taken }: { taken: TakeoverMark }) {
  return (
    <span className="mr-1 truncate text-[11px] text-faint" title={`${taken.name} took this card over and carries it on on their Mac.`}>
      {takenLabel(taken)}
    </span>
  );
}

// The teammate's picture, or their initial on a plain disc.
export function TeamAvatar({ mark, className = "size-4" }: { mark: TeamMark; className?: string }) {
  if (mark.avatar) return <img src={mark.avatar} alt="" className={`shrink-0 rounded-full object-cover ${className}`} />;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-sunken text-[9px] font-semibold text-muted ${className}`}>
      {mark.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// The card's picture, with a teammate's avatar on its corner when it's theirs.
export function TeamCardPicture({ card }: { card: Card }) {
  if (!card.team) return <CardPicture card={card} />;
  return (
    <span className="relative shrink-0" title={ownerTitle(card.team)}>
      <CardPicture card={card} />
      <span className="absolute -left-1.5 -top-1.5 rounded-full border-[1.5px] border-card bg-card">
        <TeamAvatar mark={card.team} className="size-[18px]" />
      </span>
    </span>
  );
}

export default function TeamOwnerMark({ mark, avatar = false }: { mark: TeamMark; avatar?: boolean }) {
  return (
    <span className="flex min-w-0 shrink items-center gap-1 text-[11px] text-faint" title={ownerTitle(mark)}>
      {avatar && <TeamAvatar mark={mark} />}
      <span className="truncate">{mark.takenOver ? takenLabel(mark.takenOver) : teamMacLabel(mark)}</span>
    </span>
  );
}

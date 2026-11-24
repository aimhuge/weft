"use client";

// Whose each card on weft.zip's board is and which machine runs it (lib/board-owners.ts), from its cloud_cards row:
// owner_user (ME when it's the visitor) and owner_device. A teammate's card gets the desktop's own Card.team mark, so
// the tile draws their picture on it as the desktop board does (components/TeamOwnerMark.tsx), and the person and
// machine pickers get their options with names from the page's directory (lib/board-directory.ts).
import { useMemo } from "react";
import { ME, ownerChoices, type CardPlace, type OwnerNames } from "@/lib/board-owners";
import type { BoardDirectory } from "@/lib/board-directory";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import { filterCards, type RailFilter } from "@/lib/rail-view";
import type { Card } from "@/lib/types";

export function rowPlace(row: Pick<CloudCardRow, "owner_user" | "owner_device"> | undefined, userId: string): CardPlace {
  const who = !row?.owner_user || row.owner_user === userId ? ME : row.owner_user;
  return { who, on: row?.owner_device ?? "" };
}

// The cards with a teammate's marked as theirs; the visitor's own stay as they are.
export function markTeammates(cards: Card[], rows: ReadonlyMap<string, CloudCardRow>, userId: string, directory: BoardDirectory): Card[] {
  return cards.map((card) => {
    const row = rows.get(card.id);
    if (!row?.owner_user || row.owner_user === userId || card.team) return card;
    const person = directory.people[row.owner_user];
    return { ...card, team: { org: row.org_id, owner: row.owner_user, name: person?.name ?? "A teammate", avatar: person?.avatar ?? null, device: row.owner_device } };
  });
}

export const directoryNames = (directory: BoardDirectory): OwnerNames => ({
  person: (id) => directory.people[id],
  machine: (id) => directory.machines[id],
});

export function useWebOwners(cards: Card[], rows: ReadonlyMap<string, CloudCardRow>, userId: string, directory: BoardDirectory) {
  const marked = useMemo(() => markTeammates(cards, rows, userId, directory), [cards, rows, userId, directory]);
  const placeOf = useMemo(() => (card: Card) => rowPlace(rows.get(card.id), userId), [rows, userId]);
  return { cards: marked, placeOf };
}

// The pickers' options, counted over the cards the project chip, ★ and tag leave on screen, as the desktop's are.
export function useWebOwnerChoices(cards: Card[], placeOf: (card: Card) => CardPlace, directory: BoardDirectory, filter: RailFilter, project: string | null) {
  const { starred, tag, who } = filter;
  return useMemo(() => {
    const shown = filterCards(cards, { starred, tag }).filter((c) => !project || c.cwd === project);
    return ownerChoices(shown, placeOf, directoryNames(directory), who);
  }, [cards, placeOf, directory, starred, tag, who, project]);
}

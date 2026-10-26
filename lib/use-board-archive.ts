"use client";

import { useCallback, useState } from "react";
import { api } from "./client";
import { archivedMessage, neighborAfter } from "./archive";
import { patchNow } from "./optimistic-cards";
import type { Card } from "./types";

// What the board does around archiving: archive (with an Undo toast), unarchive, and find the
// focused card the archive key acts on. The keyboard focus moves to the next card in the column
// so E, E, E clears it, and the last batch is kept for Shift+Z to undo. Both land on the board at once (lib/optimistic-cards.ts).
const fileAway = (id: string, archived: boolean) => patchNow(id, { archived }, () => api.archive(id, archived));
export interface BoardArchiveDeps {
  cards: readonly Card[];
  // The open card, if any. Set to null when the card being archived is the open one.
  selected: Card | null;
  // The id of the open card or null (kept in a ref so the archive call sees the freshest value).
  selectedIdRef: React.RefObject<string | null>;
  select: (id: string | null) => void;
  setToast: (message: string | null, action?: { label: string; run: () => void }) => void;
  notify: (err: unknown) => void;
}

export function useBoardArchive({ cards, selected, selectedIdRef, select, setToast, notify }: BoardArchiveDeps) {
  // The cards the last archive filed away, for Z and the toast's Undo.
  const [lastArchived, setLastArchived] = useState<string[]>([]);

  const unarchiveIds = useCallback(
    (ids: string[]) => {
      setLastArchived([]);
      setToast(null);
      Promise.all(ids.map((id) => fileAway(id, false))).catch(notify);
    },
    [notify, setToast],
  );

  // Archives the cards and offers an Undo (the toast's button, or Shift+Z). Keyboard focus moves to the next card
  // in the column, so E, E, E clears a column.
  const archiveCards = useCallback(
    (list: Card[], message = archivedMessage(list.map((c) => c.title))) => {
      if (!list.length) return;
      const ids = list.map((c) => c.id);
      const column = document.querySelector(`[data-card-id="${ids[0]}"]`)?.closest<HTMLElement>("[data-column]");
      const shown = [...(column?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])];
      const next = neighborAfter(shown.map((el) => el.dataset.cardId ?? ""), ids);
      if (selectedIdRef.current && ids.includes(selectedIdRef.current)) select(null);
      shown.find((el) => el.dataset.cardId === next)?.focus();
      Promise.all(ids.map((id) => fileAway(id, true))).catch(notify);
      setLastArchived(ids);
      setToast(message, { label: "Undo", run: () => unarchiveIds(ids) });
    },
    [selectedIdRef, select, notify, setToast, unarchiveIds],
  );

  // Archiving closes the thread; unarchiving leaves it open.
  const toggleArchive = useCallback(
    (card: Card) => {
      if (card.archived) fileAway(card.id, false).catch(notify);
      else archiveCards([card]);
    },
    [archiveCards, notify],
  );

  // The card the archive keys act on: the one with keyboard focus, else the open thread.
  const archiveTarget = useCallback((): Card | undefined => {
    const el = document.activeElement?.closest<HTMLElement>("[data-card-id]");
    return cards.find((c) => c.id === el?.dataset.cardId) ?? selected ?? undefined;
  }, [cards, selected]);

  return { archiveTarget, archiveCards, toggleArchive, unarchive: unarchiveIds, lastArchived };
}

"use client";

// Board actions that start or open work: open a card (warm its CLI so a reply is fast), open the
// New thread dialog, create a card, start the quality / commit-walk-through cards from the header
// badges, and run "Review all" on the Review column.
import { useCallback, useEffect } from "react";
import { api, type NewCardInput } from "./client";
import { startPileReview } from "./pile-review";
import { lastFolder } from "./board-helpers";
import { onOpenCardRequest } from "./open-card";
import { backendFor, cardModel } from "./new-thread";
import { isWorkerCard, localPath } from "./worker-project";
import type { Card } from "./types";

export interface BoardActions {
  // Open a card and warm its CLI so a reply doesn't wait on a cold start.
  openCard: (card: Card) => void;
  // Show the New thread dialog in a folder (defaults to the active project, else the last folder).
  openNew: (folder?: string) => void;
  // Create a card without opening it; the dialog closes with focus back on the board.
  create: (input: NewCardInput) => Promise<void>;
  // Start a card on behalf of a header badge (quality / pile); returns its id so the caller can open it.
  improveQuality: (cwd: string, prompt: string, title: string, model?: string) => Promise<string | undefined>;
  // "Review all" on the Review column: start the commit walk-through card.
  reviewAll: () => Promise<void>;
}

export interface BoardActionsDeps {
  selected: Card | null;
  select: (id: string | null) => void;
  setShowNew: (open: boolean) => void;
  setNewCwd: (folder: string | undefined) => void;
  // The current project filter (path) or null for "All projects".
  project: string | null;
  // The cwd of the most recent card (used when no card is open and no project is set).
  latestCwd: string | null | undefined;
  notify: (err: unknown) => void;
  // A new thread went to this worker instead of starting here, so there's no card to open yet.
  onSentToWorker?: (worker: string) => void;
}

export function useBoardActions({
  selected,
  select,
  setShowNew,
  setNewCwd,
  project,
  latestCwd,
  notify,
  onSentToWorker,
}: BoardActionsDeps): BoardActions {
  const openNew = useCallback(
    (folder?: string) => {
      setNewCwd(folder);
      setShowNew(true);
      const cwd = localPath(folder ?? project ?? lastFolder());
      if (cwd) api.warm({ cwd }).catch(() => {}); // best-effort prefetch; a cold start is fine
    },
    [project, setNewCwd, setShowNew],
  );

  const openCard = useCallback(
    (card: Card) => {
      select(card.id);
      // Start its CLI now so a reply doesn't wait.
      if (!card.warm && card.column !== "done" && !isWorkerCard(card)) api.warm({ cardId: card.id }).catch(() => {}); // best-effort prefetch
    },
    [select],
  );

  // A thread asked to open another card ("Continue in new card"): it replaces this one in the panel.
  useEffect(() => onOpenCardRequest((id) => select(id)), [select]);

  const create = useCallback(async (input: NewCardInput) => {
    const { start } = await api.create(input);
    if (start?.worker) onSentToWorker?.(start.worker);
  }, [onSentToWorker]);

  const improveQuality = useCallback(
    async (cwd: string, prompt: string, title: string, model?: string): Promise<string | undefined> => {
      // The model picks the CLI: every model is offered, and the card runs on the one that serves it.
      const backend = (model && backendFor(model)) || "claude";
      // The card's model is the id the CLI takes, so a Goose pick loses its "goose:" prefix; the
      // card's backend says it runs on Goose.
      const { card } = await api.create({ title, prompt, cwd, backend, model: cardModel(model), start: true });
      return card.id;
    },
    [],
  );

  const reviewAll = useCallback(async () => {
    const cwd = selected?.cwd ?? localPath(project) ?? latestCwd;
    if (!cwd) return;
    try {
      const { reviewAllModel } = await api.settings();
      await startPileReview(cwd, (c, prompt, title) => improveQuality(c, prompt, title, reviewAllModel || undefined), select);
    } catch (err) {
      notify(err);
    }
  }, [selected, project, latestCwd, notify, select, improveQuality]);

  return { openCard, openNew, create, improveQuality, reviewAll };
}
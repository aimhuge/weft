"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch } from "./api-client";
import type { ProjectWorker } from "./board-view";
import type { Card, PermissionMode, QuestionReply } from "./types";
import { EMPTY_WORKER_BOARD, type WorkerBoard } from "./worker-project";
import { readWorkerMarks, subscribeWorkerMarks, workerMarksSnapshot, type WorkerMarks } from "./worker-project-marks";
import type { GrantScope } from "./cloud-commands";
import { applyIntents, onOptimistic, overlayAll, patchNow } from "./optimistic-cards";
import { hostOf } from "./project-host";
import { mergeBoard, FULL_READ_EVERY_MS } from "./worker-board-merge";
import { clearActiveCards, markWholeRead, setActiveCards } from "./worker-poll";
import { sendWorkerAction } from "./worker-transport";
import { onLineEvents } from "./session-lines";
import type { LineEvent } from "./host-line-protocol";

// A card change off a worker's session line, laid over the cards read last: the card keeps the board's worker:// path,
// and one the board hasn't read yet waits for the next read, which knows its project.
export function withLineEvent(cards: Card[], event: LineEvent): Card[] {
  if (event.t === "card_deleted") return cards.filter((c) => c.id !== event.id);
  if (event.t !== "card") return cards;
  return cards.map((c) => (c.id === event.card.id ? { ...event.card, cwd: c.cwd } : c));
}

// Your workers' projects and cards on the desktop board, read through the local server every few seconds (only the cards changed since the last read, a whole read every
// FULL_READ_EVERY_MS). They stay
// in this hook's state, never in the board's cards or the local store. With no worker of yours it looks once a
// minute, so a signed-out or worker-less Mac does next to nothing.
export const BOARD_POLL_MS = 5_000;
export const IDLE_POLL_MS = 60_000;

// With `since`, only the cards changed after it (lib/worker-board-merge.ts).
async function load(since?: string): Promise<WorkerBoard | null> {
  try {
    const res = await apiFetch(since ? `/api/worker-board?${new URLSearchParams({ since }).toString()}` : "/api/worker-board");
    return res.ok ? ((await res.json()) as WorkerBoard) : null;
  } catch {
    return null;
  }
}

// The cards are drawn through lib/optimistic-cards.ts as this Mac's are (lib/board-live.ts): a star, a move or a stop on
// a worker's card shows at once, a read that already shows it settles it, and a refusal reloads.
export function useWorkerBoard(): WorkerBoard {
  const [board, setBoard] = useState<WorkerBoard>(EMPTY_WORKER_BOARD);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let projects = 0;
    // The last read before the cards were drawn, what a changed-cards read lays over; null forces a whole read.
    let raw: WorkerBoard | null = null;
    let wholeAt = 0;
    // A reload while a read is out starts a newer read: only the newest one draws and sets the next timer, so two
    // polling loops never run side by side.
    let latest = 0;
    const tick = async () => {
      const mine = ++latest;
      clearTimeout(timer);
      const since = raw?.asOf && Date.now() - wholeAt < FULL_READ_EVERY_MS ? raw.asOf : undefined;
      const next = await load(since);
      if (!alive || mine !== latest) return;
      // A failed read keeps what's drawn, so a blip doesn't empty the projects.
      if (next) {
        if (!next.delta) {
          wholeAt = Date.now();
          markWholeRead();
        }
        raw = mergeBoard(raw ?? EMPTY_WORKER_BOARD, next);
        projects = raw.projects.length;
        setActiveCards(raw.cards);
        setBoard({ ...raw, cards: overlayAll(raw.cards) });
      }
      timer = setTimeout(() => void tick(), projects ? BOARD_POLL_MS : IDLE_POLL_MS);
    };
    // A refused change reads the cards again; any other redraws them with what's still open.
    const off = onOptimistic((update) => {
      if (update.kind === "reload") {
        raw = null;
        void tick();
      }
      else setBoard((b) => ({ ...b, cards: applyIntents(b.cards) }));
    });
    const offLine = onLineEvents((_, event) => {
      if (event.t === "card" || event.t === "card_deleted") setBoard((b) => ({ ...b, cards: overlayAll(withLineEvent(b.cards, event)) }));
    });
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearActiveCards();
      off();
      offLine();
    };
  }, []);

  return board;
}

// The board's cards with your workers' beside them: `cards` stays this Mac's own, and what's drawn reads boardCards.
// Each worker project carries this board's pin and hide for it (lib/worker-project-marks.ts).
export function useBoardWorkers(cards: Card[]) {
  const read = useWorkerBoard();
  const marks = useSyncExternalStore(subscribeWorkerMarks, workerMarksSnapshot, () => "{}");
  const workers = useMemo(() => withMarks(read, readWorkerMarks(marks)), [read, marks]);
  const boardCards = useMemo(() => [...cards, ...workers.cards], [cards, workers.cards]);
  return { workers, boardCards };
}

export function withMarks(board: WorkerBoard, marks: Record<string, WorkerMarks>): WorkerBoard {
  if (!board.projects.some((p) => marks[p.path])) return board;
  return { ...board, projects: board.projects.map((p) => (marks[p.path] ? { ...p, ...marks[p.path] } : p)) };
}

interface ThreadCtx {
  select: (id: string | null) => void;
  notify: (err: unknown) => void;
}

// The open worker card, the worker it runs on and what its thread can do. Null when the open card isn't a worker's.
export function openWorkerThread(board: Pick<WorkerBoard, "cards" | "projects">, selectedId: string | null, ctx: ThreadCtx) {
  const card = board.cards.find((c) => c.id === selectedId);
  if (!card) return null;
  const project = board.projects.find((p) => p.path === card.cwd);
  const worker: ProjectWorker = { name: project?.worker ?? "Your worker", status: project?.status ?? "offline" };
  return { card, worker, handlers: workerThreadHandlers(card, ctx) };
}

export type WorkerThread = NonNullable<ReturnType<typeof openWorkerThread>>;

// A worker card's thread actions, in the shape ThreadPanel takes: send and answer go out as commands, a rename as a
// host verb (lib/project-host.ts), drawn at once and taken back if the worker refuses. What only the machine running the
// card can do has no handler, so the panel doesn't offer it.
export function workerThreadHandlers(card: Card, ctx: ThreadCtx) {
  return {
    onSend: (text: string) => sendWorkerAction({ action: "reply", cardId: card.id, text }).then(() => {}),
    onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope) => {
      const pendingId = card.pending?.id;
      if (!pendingId) return Promise.resolve();
      return sendWorkerAction({ action: "answer", cardId: card.id, pendingId, allow, answers, reply, grant }).then(() => {}, (err: unknown) => {
        ctx.notify(err);
        throw err;
      });
    },
    // The same card.update the tile's menu sends (lib/use-board-menus.ts); a worker refuses YOLO from the network.
    onMode: (mode: PermissionMode) => void patchNow(card.id, { permissionMode: mode }, () => hostOf(card).act("card.update", { id: card.id, body: { permissionMode: mode } })).catch(ctx.notify),
    onRename: (title: string) => void patchNow(card.id, { title }, () => hostOf(card).act("card.update", { id: card.id, body: { title } })).catch(ctx.notify),
    onClose: () => ctx.select(null),
  };
}

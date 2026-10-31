"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { ProjectWorker } from "./board-view";
import type { Card, PermissionMode, QuestionReply } from "./types";
import { EMPTY_WORKER_BOARD, type WorkerBoard } from "./worker-project";
import type { GrantScope } from "./cloud-commands";
import { sendWorkerAction } from "./worker-transport";

// Your workers' projects and cards on the desktop board, read through the local server every few seconds. They stay
// in this hook's state, never in the board's cards or the local store. With no worker of yours it looks once a
// minute, so a signed-out or worker-less Mac does next to nothing.
export const BOARD_POLL_MS = 5_000;
export const IDLE_POLL_MS = 60_000;

async function load(): Promise<WorkerBoard | null> {
  try {
    const res = await apiFetch("/api/worker-board");
    return res.ok ? ((await res.json()) as WorkerBoard) : null;
  } catch {
    return null;
  }
}

export function useWorkerBoard(): WorkerBoard {
  const [board, setBoard] = useState<WorkerBoard>(EMPTY_WORKER_BOARD);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let projects = 0;
    const tick = async () => {
      clearTimeout(timer);
      const next = await load();
      if (!alive) return;
      // A failed read keeps what's drawn, so a blip doesn't empty the projects.
      if (next) {
        projects = next.projects.length;
        setBoard(next);
      }
      timer = setTimeout(() => void tick(), projects ? BOARD_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return board;
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

// A worker card's thread actions, in the shape ThreadPanel takes: send and answer go out as commands. What only the
// machine running the card can do has no handler, so the panel doesn't offer it.
export function workerThreadHandlers(card: Card, ctx: ThreadCtx) {
  return {
    onSend: (text: string) => sendWorkerAction({ action: "reply", cardId: card.id, text }),
    onAnswer: (allow: boolean, answers?: Record<string, string>, reply?: QuestionReply, grant?: GrantScope) => {
      const pendingId = card.pending?.id;
      if (!pendingId) return Promise.resolve();
      return sendWorkerAction({ action: "answer", cardId: card.id, pendingId, allow, answers, reply, grant }).catch((err: unknown) => {
        ctx.notify(err);
        throw err;
      });
    },
    onMode: (mode: PermissionMode) => void sendWorkerAction({ action: "mode", cardId: card.id, mode }).catch(ctx.notify),
    onClose: () => ctx.select(null),
  };
}

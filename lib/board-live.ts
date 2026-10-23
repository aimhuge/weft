import type { Dispatch, RefObject, SetStateAction } from "react";
import { api } from "./client";
import { cardChangeEffects } from "./board-view";
import { announce, without } from "./board-helpers";
import { playChime } from "./chimes";
import { announceAccountChange } from "./use-account";
import { useBoardEvents } from "./use-events";
import type { BoardEvent, Card, Column, LoginView, Project, RestartStatus, ThreadItem } from "./types";

// The board's live updates: what each server event does to the board's state, and the full reload on
// the first connect and every reconnect so nothing is missed. Board.tsx holds the state; this holds
// what happens to it.
export interface BoardLive {
  // Each card's last known column and error, to notice a move or a new error.
  columns: RefObject<Map<string, Column>>;
  errors: RefObject<Map<string, string | undefined>>;
  // The board's own drag moves, so their echo doesn't chime.
  ownMoves: RefObject<Map<string, { column: Column; at: number }>>;
  selectedRef: RefObject<string | null>;
  // Folders the server has already resolved into roots.
  resolvedFolders: RefObject<Set<string>>;
  select: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setCards: Dispatch<SetStateAction<Card[]>>;
  setUnseen: Dispatch<SetStateAction<ReadonlySet<string>>>;
  setThread: Dispatch<SetStateAction<ThreadItem[]>>;
  setStreaming: Dispatch<SetStateAction<string>>;
  setProjects: (projects: Project[]) => void;
  setLogin: (login: LoginView | null) => void;
  setToast: (message: string) => void;
  setHome: (home: string) => void;
  setRoots: (roots: Record<string, string>) => void;
  setLoaded: (loaded: boolean) => void;
  updateCopilot: (card: Card) => void;
  loadCopilot: () => void;
  resolveFolders: (folders: string[]) => void;
  restart: { apply: (status: RestartStatus) => void; reload: () => void };
  loadFromPrefs: () => void;
  loadThread: (id: string) => void;
  notify: (err: unknown) => void;
}

// A card changed: chime and highlight it if it moved or newly failed, then put it on the board.
function onCard(card: Card, live: BoardLive) {
  // The copilot is a thread too, but it has its own lane and no project.
  if (card.role === "copilot") {
    live.updateCopilot(card);
    return;
  }
  const { id, column, error } = card;
  const effects = cardChangeEffects({
    previous: live.columns.current.get(id),
    column,
    previousError: live.errors.current.get(id),
    error,
    own: live.ownMoves.current.get(id),
    now: Date.now(),
    open: live.selectedRef.current === id,
  });
  live.columns.current.set(id, column);
  live.errors.current.set(id, error);
  if (effects.moved) {
    announce(card, () => live.select(id));
    live.ownMoves.current.delete(id);
  }
  if (effects.chime) playChime(effects.chime);
  if (effects.markUnseen) live.setUnseen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  if (effects.errorChime) playChime("error");
  live.resolveFolders([card.cwd]);
  live.setCards((prev) => {
    const at = prev.findIndex((c) => c.id === id);
    if (at === -1) return [card, ...prev];
    const next = prev.slice();
    next[at] = card;
    return next;
  });
}

// The open card's thread got an item (or was cut back to it); a finished reply ends the streaming text.
function onThreadItem(event: Extract<BoardEvent, { type: "thread" }>, live: BoardLive) {
  live.setThread((prev) => {
    const next = event.truncate ? prev.slice(0, event.index) : prev.slice();
    next[event.index] = event.item;
    return next;
  });
  if (event.item.kind === "assistant" || event.item.kind === "result") live.setStreaming("");
}

export function onBoardEvent(event: BoardEvent, live: BoardLive) {
  switch (event.type) {
    case "card":
      onCard(event.card, live);
      break;
    case "card_deleted":
      live.setCards((prev) => prev.filter((c) => c.id !== event.id));
      live.setUnseen((prev) => (prev.has(event.id) ? without(prev, event.id) : prev));
      if (live.selectedRef.current === event.id) live.setSelectedId(null);
      break;
    case "thread":
      if (event.cardId === live.selectedRef.current) onThreadItem(event, live);
      break;
    case "delta":
      if (event.cardId === live.selectedRef.current) live.setStreaming((text) => text + event.text);
      break;
    case "account":
      announceAccountChange();
      break;
    case "restart":
      live.restart.apply(event.restart);
      if (event.restart.error) live.setToast(event.restart.error);
      break;
    case "projects":
      live.resolveFolders(event.projects.map((p) => p.path));
      live.setProjects(event.projects);
      break;
    case "login":
      live.setLogin(event.login.state === "cancelled" ? null : event.login);
      break;
  }
}

// The first connect and every reconnect: reload the cards, the projects and everything else live.
export function reloadBoard(live: BoardLive) {
  api
    .list()
    .then((data) => {
      live.columns.current = new Map(data.cards.map((c) => [c.id, c.column]));
      live.errors.current = new Map(data.cards.map((c) => [c.id, c.error]));
      for (const c of data.cards) live.resolvedFolders.current.add(c.cwd);
      live.setCards(data.cards);
      live.setHome(data.home);
      live.setRoots(data.roots);
      live.setLoaded(true);
    })
    .catch(live.notify);
  api
    .settings()
    .then((settings) => {
      // The card list resolved the saved projects too.
      for (const p of settings.projects) live.resolvedFolders.current.add(p.path);
      live.setProjects(settings.projects);
    })
    .catch(() => {});
  live.loadFromPrefs();
  live.loadCopilot();
  live.restart.reload();
  if (live.selectedRef.current) live.loadThread(live.selectedRef.current);
}

// Board's way in: subscribes to the event stream with the latest state setters each render.
export function useBoardLive(live: BoardLive) {
  useBoardEvents(
    (event) => onBoardEvent(event, live),
    () => reloadBoard(live),
  );
}

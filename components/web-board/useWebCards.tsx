"use client";

// What weft.zip's board does to its cards, by the desktop board's own hooks: the tile's handlers and the list view's
// rows (lib/use-board-cards.tsx), drag between columns (lib/use-board-card-actions.ts, every card "remote"), archive
// with Undo (lib/use-board-archive.ts), and the right-click menus (components/use-board-menus.ts) drawn by WebMenu. Each
// card's host is the web's one host (lib/web-host.ts), so every action is a host verb for the machine that runs the
// card, drawn at once (lib/optimistic-cards.ts). A teammate's card is drawn read-only: only its owner's machine obeys.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { CardActionsCtx } from "@/lib/card-handlers";
import { patchNow } from "@/lib/optimistic-cards";
import { busyHere } from "@/lib/overlap";
import { hostOf } from "@/lib/project-host";
import { tagCounts } from "@/lib/tags";
import type { Card, Column, PermissionMode } from "@/lib/types";
import { useBoardArchive } from "@/lib/use-board-archive";
import { useBoardCardActions } from "@/lib/use-board-card-actions";
import { useBoardCards, type CardViewComponent } from "@/lib/use-board-cards";
import { useToast } from "@/lib/use-toast";
import BoardToast from "../BoardToast";
import CardRow, { type RowNest } from "../CardRow";
import CardView from "../CardView";
import TagsDialog from "../TagsDialog";
import { useBoardMenus } from "../use-board-menus";
import { useWebMenu } from "./WebMenu";

export interface WebCardsInput {
  // Every card on the board, with what's on its way drawn on it.
  cards: Card[];
  // Whether the visitor's own machine runs the card (lib/web-commands.ts canReply).
  mine: (cardId: string) => boolean;
  now: number;
  selectedId: string | null;
  open: (card: Card) => void;
  close: () => void;
  openNew: () => void;
  // A tile's Allow or Deny, as the open thread answers it (a passkey signs on sign.weft.zip).
  answer: (card: Card, allow: boolean) => void;
  showArchived: boolean;
  toggleArchived: () => void;
  onTag: (tag: string) => void;
}

const NONE: Card[] = [];
const noop = () => {};

// The open card's header controls, over the same verbs as the tile and the menu.
export interface WebCardEdits {
  onRename: (title: string) => void;
  onMode: (mode: PermissionMode) => void;
  onStar: () => void;
  onArchive: () => void;
  onTags: () => void;
}

export function useWebCards(input: WebCardsInput) {
  const { cards, mine, now, selectedId, open, close, openNew, answer, showArchived, toggleArchived, onTag } = input;
  const { toast, setToast, notify } = useToast();
  const { popup, menu } = useWebMenu();
  const [over, setOver] = useState<Column | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  });
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  // Every card here runs on another machine, so all of them are the hook's remote ones: moved through their host.
  const { move, drop } = useBoardCardActions({ cards: NONE, remote: cards, setCards: noop, setDragOver: setOver, notify });
  const select = useCallback((id: string | null) => (id ? undefined : close()), [close]);
  const { archiveCards, toggleArchive, unarchive } = useBoardArchive({ cards, selected, selectedIdRef: selectedRef, select, setToast, notify });
  // Done's own cards, for its Archive all and the column menu's.
  const done = cards.filter((c) => c.column === "done" && !c.archived && mine(c.id));
  const menus = useBoardMenus({
    doneShown: done,
    archivedCount: cards.filter((c) => c.archived).length,
    showArchived,
    openCard: open,
    renameCard: (card) => {
      open(card);
      setRenameId(card.id);
    },
    move,
    toggleArchive,
    archive: archiveCards,
    // No delete verb reaches another machine yet: the remote menu has no Delete.
    remove: noop,
    openNew: () => openNew(),
    toggleArchived,
    toast: setToast,
    notify,
    popupMenu: popup,
  });

  const ctx: CardActionsCtx = { openCard: open, resume: noop, move, onCardMenu: menus.onCardMenu, toggleStar: menus.toggleStar, toggleArchive, onTag, notify };
  const own = useBoardCards({ cards, now, selectedId, lastOpenId: null, unseen: EMPTY, restartRequestedBy: null, ctx, CardView: WebTile });
  const tile = (card: Card) => ({ card, now, selected: card.id === selectedId, alsoHere: busyHere(cards, card), onOpen: () => open(card) });
  const renderCard = (card: Card): ReactNode => (mine(card.id) ? own.renderCard(card) : <CardView key={card.id} readOnly {...tile(card)} />);
  const renderRow = (card: Card, column: Column, nest?: RowNest): ReactNode =>
    mine(card.id) ? own.renderRow(card, column, nest) : <CardRow key={card.id} column={column} nest={nest} {...tile(card)} />;

  const editsFor = (card: Card): WebCardEdits => ({
    onRename: (title) => void patchNow(card.id, { title }, () => hostOf(card).act("card.update", { id: card.id, body: { title } })).catch(notify),
    onMode: (permissionMode) => void patchNow(card.id, { permissionMode }, () => hostOf(card).act("card.update", { id: card.id, body: { permissionMode } })).catch(notify),
    onStar: () => menus.toggleStar(card),
    onArchive: () => toggleArchive(card),
    onTags: () => menus.editTags(card),
  });

  const overlays = (
    <>
      {menu}
      {menus.tagging && <TagsDialog card={menus.tagging} all={tagCounts(cards)} onChange={menus.saveTags} onClose={menus.closeTags} />}
      {toast && <BoardToast text={toast.text} action={toast.action} onDismiss={() => setToast(null)} />}
    </>
  );

  // The tile's Allow and Deny go the way the open thread's do (WebTile reads it); the rest are the desktop's remote handlers.
  const withAnswers = (children: ReactNode) => <TileAnswer.Provider value={answer}>{children}</TileAnswer.Provider>;

  return {
    withAnswers,
    renderCard,
    renderRow,
    drag: { over, setOver, onDrop: drop, onReorder: noop },
    onColumnMenu: (column: Column, e: React.MouseEvent) => void menus.onColumnMenu(column, e),
    // Done's Archive all and the toast's Undo, for the columns' archive bundle.
    archive: { done, cards: archiveCards, restore: unarchive },
    editsFor,
    renameId,
    overlays,
    toast: setToast,
    notify,
  };
}

const EMPTY: ReadonlySet<string> = new Set();

const TileAnswer = createContext<(card: Card, allow: boolean) => void>(noop);

// The desktop's tile, with Allow and Deny answered as the web board answers them.
const WebTile: CardViewComponent = (props) => {
  const answer = useContext(TileAnswer);
  return <CardView {...props} onAnswer={(allow) => answer(props.card, allow)} />;
};

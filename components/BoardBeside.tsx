"use client";

// What sits between the rail and the board's cards: simple mode's sidebar list (components/BoardSidebar.tsx), when the
// board draws as one, then the board's own browser pane while no card is open. Both come before the cards in the row.
import BoardBrowserPane, { type BoardBrowserPaneProps } from "./BoardBrowserPane";
import { useThreadShown } from "@/lib/pane-rail-open";
import BoardSidebar, { type BoardSidebarProps } from "./BoardSidebar";

export interface BoardBesideProps {
  // The board's surface mode (lib/use-board-sidebar.ts): "sidebar" draws the sidebar.
  mode: string;
  // A card or New thread is open in the frame (components/BoardFrame.tsx).
  framed: boolean;
  sidebar: BoardSidebarProps;
  pane: BoardBrowserPaneProps;
}

export default function BoardBeside({ mode, framed, sidebar, pane }: BoardBesideProps) {
  // The open card's thread is showing beside its page (lib/pane-rail-open.ts): the list folds away to give it the room.
  const thread = useThreadShown();
  return (
    <>
      {mode === "sidebar" && <BoardSidebar {...sidebar} folded={framed && thread} />}
      {/* Only while no card is open (framed), so its X toggles the pane rather than closing a card. */}
      {!framed && <BoardBrowserPane {...pane} />}
    </>
  );
}

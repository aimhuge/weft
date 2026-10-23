"use client";

// The rail's two board-only buttons: ★ filters the board to starred cards, 🏷 opens the tags drawer.
// They sit on the desktop's rail (components/LibraryRail.tsx) and on weft.zip's (components/web-board/WebRail.tsx),
// which is why they live here: one drawing, one behaviour, two hosts.
//
// The tags drawer itself is the host's — the desktop's is the full TagsDrawer, the web's a read-only list of the
// synced tags — so only the button is shared.

import { useEffect, useState } from "react";

// ★: filters the board to starred cards (again shows every card); its badge counts them. Drop a card on it to star it.
export function StarRailButton({ on, count, cardDrag, onClick, onDropCard }: { on: boolean; count: number; cardDrag: boolean; onClick: () => void; onDropCard?: (cardId: string) => void }) {
  const [dropOn, setDropOn] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        setDropOn(true);
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOn(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropCard?.(id);
      }}
      title={on ? "Showing starred cards · click to show every card" : "Show only starred cards · drop a card here to star it"}
      aria-pressed={on}
      className={`relative grid size-7 place-items-center rounded-md text-[15px] ${on || cardDrag ? "bg-accent-soft text-warn" : "text-muted hover:bg-sunken hover:text-warn"} ${dropOn ? "outline-2 outline-offset-2 outline-dashed outline-accent" : cardDrag ? "ring-1 ring-accent" : ""}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      <span className="sr-only">Starred cards</span>
      {count > 0 && <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent px-1 text-center text-[9px] font-semibold leading-[14px] text-on-accent">{count}</span>}
    </button>
  );
}

// 🏷: opens the tags drawer; a dot when the board is filtered to a tag. Dragging a card over it opens the
// drawer, so the card can drop on a tag.
export function TagsRailButton({ open, tag, cardDrag, onOpen }: { open: boolean; tag?: string; cardDrag: boolean; onOpen: (open: boolean) => void }) {
  return (
    <button
      onClick={() => onOpen(!open)}
      onDragOver={(e) => {
        e.preventDefault();
        if (!open) onOpen(true);
      }}
      title={tag ? `Showing #${tag} · open the tags` : "Tags: filter the board, add, rename, recolour"}
      aria-pressed={open}
      className={`relative grid size-7 place-items-center rounded-md text-[14px] ${open || tag || cardDrag ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} ${cardDrag ? "ring-1 ring-accent" : ""}`}
    >
      <span aria-hidden>🏷</span>
      <span className="sr-only">Tags</span>
      {tag && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-panel" aria-label={`Filtered to ${tag}`} />}
    </button>
  );
}

// A card is being dragged somewhere on the board: ★ and 🏷 light up to show they take drops. Both rails listen.
export function useRailCardDrag() {
  const [cardDrag, setCardDrag] = useState(false);
  useEffect(() => {
    const start = (e: DragEvent) => setCardDrag(e.target instanceof Element && e.target.closest("[data-card-id]") !== null);
    const end = () => setCardDrag(false);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
  return cardDrag;
}

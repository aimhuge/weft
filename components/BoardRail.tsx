"use client";

// The board's left rail: the library drawer (projects, tags, secrets, tools) beside the columns.
// It is its own component so Board.tsx hands over state instead of spelling out the rail's props.
import type { Card } from "@/lib/types";
import type { RailFilter, RailPanel } from "@/lib/rail-view";
import type { RailContext } from "./rail-context";
import type { TagCatalog } from "./use-tag-catalog";
import { guarded } from "./guarded";

const SideRail = guarded(() => import("./LibraryRail"), { what: "rail", className: "m-3 w-[220px] self-start" });

export interface BoardRailProps {
  open: RailPanel | null;
  onOpen: (panel: RailPanel | null) => void;
  ctx: RailContext;
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  // Starring from the rail stars the card, and only if it isn't already starred.
  onStarCard: (card: Card) => void;
  onTagCard: (id: string, tag: string) => void;
  catalog: TagCatalog;
  onClosePane: () => void;
  paneUrl?: string;
}

export default function BoardRail(props: BoardRailProps) {
  return (
    <SideRail
      open={props.open}
      onOpen={props.onOpen}
      ctx={props.ctx}
      filter={props.filter}
      onFilter={props.onFilter}
      onStarCard={(id) => {
        const card = props.ctx.cards.find((c) => c.id === id);
        if (card && !card.starred) props.onStarCard(card);
      }}
      onTagCard={props.onTagCard}
      catalog={props.catalog}
      onClosePane={props.onClosePane}
      paneUrl={props.paneUrl}
    />
  );
}

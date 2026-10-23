"use client";

// The weft.zip board's left edge, the desktop's 38px rail (components/LibraryRail.tsx): ★ filters the board to
// starred cards and 🏷 opens the tags drawer, both the desktop's own buttons (components/RailBoardButtons.tsx). Under a
// divider the workspace's pages (Board, lit, then Team and Billing) — where the Mac keeps its drawers.
import { useState } from "react";
import { CreditCard, LayoutGrid, Users } from "lucide-react";
import { tagCounts } from "@/lib/tags";
import type { Card } from "@/lib/types";
import { StarRailButton, TagsRailButton, useRailCardDrag } from "../RailBoardButtons";
import { TagDot } from "../TagPill";

const LINK = "grid size-7 place-items-center rounded-md";

export function WebRail({
  orgSlug,
  starred,
  starredCount,
  onStarred,
  cards = [],
  tag,
  onTag,
}: {
  orgSlug: string;
  starred: boolean;
  starredCount: number;
  onStarred: () => void;
  // The board's cards, for the tags drawer: every tag the synced cards carry, with its count.
  cards?: Card[];
  // The tag the board is filtered to, if any.
  tag?: string;
  onTag?: (tag: string | undefined) => void;
}) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const cardDrag = useRailCardDrag();
  const tags = tagCounts(cards);
  const pages = [
    { id: "board", label: "Board", Icon: LayoutGrid },
    { id: "team", label: "Team", Icon: Users },
    { id: "billing", label: "Billing", Icon: CreditCard },
  ] as const;
  return (
    <nav className="hidden w-[38px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel pt-2 sm:flex" aria-label="Rail">
      <StarRailButton on={starred} count={starredCount} cardDrag={cardDrag} onClick={onStarred} />
      {onTag && <TagsRailButton open={tagsOpen} tag={tag} cardDrag={cardDrag} onOpen={setTagsOpen} />}
      <span className="my-1 h-px w-5 bg-line" aria-hidden />
      {pages.map(({ id, label, Icon }) => (
        <a
          key={id}
          href={`/${orgSlug}/${id}`}
          title={label}
          aria-current={id === "board" ? "page" : undefined}
          className={`${LINK} ${id === "board" ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
        >
          <Icon size={15} aria-hidden />
          <span className="sr-only">{label}</span>
        </a>
      ))}
      {tagsOpen && onTag && (
        <TagsList tags={tags} active={tag} onPick={(next) => onTag(next === tag ? undefined : next)} />
      )}
    </nav>
  );
}

// The tags the synced cards carry, as a list under the rail's 🏷. The Mac owns the catalog (creating, renaming and
// recolouring tags), so here a tag is only a filter to click.
function TagsList({ tags, active, onPick }: { tags: { tag: string; count: number }[]; active?: string; onPick: (tag: string | undefined) => void }) {
  if (!tags.length) return <p className="mt-1 w-[120px] px-1 text-[11px] text-faint">No tags yet</p>;
  return (
    <ul className="mt-1 flex w-[130px] flex-col gap-0.5 rounded-md border border-line bg-panel p-1 shadow-lg">
      {tags.map(({ tag, count }) => (
        <li key={tag}>
          <button
            onClick={() => onPick(tag)}
            title={`Show only #${tag}`}
            className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11.5px] ${tag === active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <TagDot tag={tag} />
            <span className="min-w-0 flex-1 truncate">#{tag}</span>
            <span className="shrink-0 tabular-nums text-faint">{count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

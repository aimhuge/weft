// What the list view's tests share (components/BoardList.test.tsx, components/BoardList.keys.test.tsx): the props a
// sheet starts from, a row stub that shows its place in the tree, and the titles the sheet shows.
import { vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import type { BoardListProps } from "./BoardList";
import { makeCard } from "./test-utils";

// The titles of the rows the sheet shows, top to bottom.
export const rows = (container: HTMLElement) => [...container.querySelectorAll("[data-card-id]")].map((el) => el.textContent);

// A row that says its depth and offers its fold toggle, and tells the test what it drew.
export function recordRow(seen?: (card: Card, column: Column) => void): BoardListProps["renderRow"] {
  return function RecordedRow(card, column, nest) {
    seen?.(card, column);
    return (
      <div data-card-id={card.id} data-depth={nest?.depth}>
        {nest?.kids ? <button aria-label={`Fold ${card.title}`} onClick={nest.onToggle} /> : null}
        {card.title}
      </div>
    );
  };
}

export function listProps(over: Partial<BoardListProps> = {}): BoardListProps {
  return {
    byColumn: new Map<Column, Card[]>([
      ["running", [makeCard({ id: "r1", title: "Running one" })]],
      ["done", [makeCard({ id: "d1", title: "Done one" })]],
    ]),
    renderRow: recordRow(),
    onNew: vi.fn(),
    ...over,
  };
}

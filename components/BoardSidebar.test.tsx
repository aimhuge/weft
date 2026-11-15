// @vitest-environment jsdom
// Simple mode's sidebar board: with the three piles on, the board is one list of sections beside the rest of the
// window; with the piece off, the columns draw as before. The columns and the browser pane are stubbed.
import { setThreadShown } from "@/lib/pane-rail-open";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import { COLUMNS } from "@/lib/types";
import { useSurfaceMode } from "@/lib/use-board-sidebar";
import { makeCard } from "./test-utils";

vi.mock("./BoardColumns", () => ({ default: () => <section data-board="columns">columns</section> }));
vi.mock("./BoardBrowserPane", () => ({ default: () => <aside data-board="pane">pane</aside> }));

import BoardBeside from "./BoardBeside";
import BoardSurface, { type BoardSurfaceProps } from "./BoardSurface";

const piece = (on: boolean) => (document.cookie = `weft-simple-three-piles=${on ? 1 : 0}; path=/`);

afterEach(() => {
  document.cookie = "weft-simple-three-piles=; path=/; max-age=0";
  document.cookie = "weft-simple-opened-columns=; path=/; max-age=0";
});

const NOW = 1_700_000_000_000;
const byColumn = new Map<Column, Card[]>([
  ["needs_you", [makeCard({ id: "a", title: "Pick a plan", column: "needs_you", updatedAt: NOW - 5 * 60_000 })]],
  ["running", [makeCard({ id: "b", title: "Build the page", column: "running", updatedAt: NOW }), makeCard({ id: "c", title: "Fix the test", column: "running", updatedAt: NOW })]],
  ["done", [makeCard({ id: "d", title: "Shipped thing", column: "done", updatedAt: NOW })]],
]);

// The board's row as Board.tsx draws it: what goes beside the cards, then the cards' surface.
function Row({ onOpen, framed = false }: { onOpen: (card: Card) => void; framed?: boolean }) {
  const mode = useSurfaceMode("board");
  const surface = { mode, columns: COLUMNS, byColumn, onNew: vi.fn(), drag: { over: null, setOver: vi.fn() } } as unknown as BoardSurfaceProps;
  return (
    <div>
      <BoardBeside
        mode={mode}
        framed={framed}
        sidebar={{ columns: COLUMNS, byColumn, loaded: true, now: NOW, selectedId: "b", onOpen }}
        pane={{ open: true, desktop: true, state: {} as never, width: 400, onWidth: vi.fn(), obscured: false, onClose: vi.fn(), items: [] }}
      />
      <BoardSurface {...surface} />
    </div>
  );
}

const sections = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-board-sidebar] section")].map((s) => s.getAttribute("data-column"));

describe("the sidebar board", () => {
  it("lists the three piles, then Backlog and Done shut, with counts, beside the pane", () => {
    piece(true);
    const { container } = render(<Row onOpen={vi.fn()} />);
    expect(sections(container)).toEqual(["needs_you", "running", "review", "backlog", "done"]);
    expect(container.querySelector('[data-board="columns"]')).toBeNull();
    expect(container.querySelector('[data-board="pane"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Working\s*2/ })).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.queryByText("Shipped thing")).toBeNull();
    // The open card's row is marked.
    expect(container.querySelector('[data-sidebar-card="b"]')).toHaveAttribute("aria-current", "true");
  });

  it("opens a card on a row's click, and Done from its header", () => {
    piece(true);
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Pick a plan"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    const done = screen.getByRole("button", { name: /Done\s*1/ });
    expect(done).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(done);
    expect(screen.getByText("Shipped thing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Done\s*1/ }));
    expect(screen.queryByText("Shipped thing")).toBeNull();
  });

  it("hides the board's pane while a card is open, and folds the list while its thread shows", () => {
    piece(true);
    const view = render(<Row onOpen={vi.fn()} framed />);
    expect(view.container.querySelector('[data-board="pane"]')).toBeNull();
    const list = view.container.querySelector("[data-board-sidebar]");
    expect(list).not.toHaveAttribute("aria-hidden");
    act(() => setThreadShown(true));
    expect(list).toHaveAttribute("aria-hidden", "true");
    expect(list?.className).toContain("w-0");
    act(() => setThreadShown(false));
  });

  it("draws the columns as before with the piece off", () => {
    piece(false);
    const { container } = render(<Row onOpen={vi.fn()} />);
    expect(container.querySelector("[data-board-sidebar]")).toBeNull();
    expect(container.querySelector('[data-board="columns"]')).toBeInTheDocument();
    expect(container.querySelector('[data-board="pane"]')).toBeInTheDocument();
  });
});

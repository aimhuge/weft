// @vitest-environment jsdom
// A column's band in the list view: its name, its count and its colour, and the + that opens the quick
// add for the bands you can type into.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetGroup } from "@/lib/list-tree";
import SheetBand from "./SheetBand";
import "./test-utils";

afterEach(cleanup);

const group = (over: Partial<SheetGroup> = {}): SheetGroup => ({
  column: "review",
  label: "Review",
  rows: [],
  shown: 3,
  total: 3,
  collapsed: false,
  ...over,
});

describe("SheetBand", () => {
  it("toggles archived cards from the Done band, and only when there are some", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<SheetBand group={group({ column: "done", label: "Done" })} onFold={vi.fn()} archive={{ count: 4, shown: false, onToggle }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 4 archived" }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<SheetBand group={group({ column: "done", label: "Done" })} onFold={vi.fn()} archive={{ count: 4, shown: true, onToggle }} />);
    expect(screen.getByRole("button", { name: "Hide archived" })).toHaveAttribute("aria-pressed", "true");
    rerender(<SheetBand group={group({ column: "done", label: "Done" })} onFold={vi.fn()} archive={{ count: 0, shown: false, onToggle }} />);
    expect(screen.queryByRole("button", { name: /archived/ })).toBeNull();
  });

  it("shows the column's name and count", () => {
    render(<SheetBand group={group()} onFold={vi.fn()} />);
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("says how many of the column's cards are shown", () => {
    render(<SheetBand group={group({ shown: 2, total: 5 })} onFold={vi.fn()} />);
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
  });

  it("folds and unfolds the column", () => {
    const onFold = vi.fn();
    render(<SheetBand group={group()} onFold={onFold} />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    expect(onFold).toHaveBeenCalled();
  });

  it("says a folded column is folded", () => {
    render(<SheetBand group={group({ collapsed: true })} onFold={vi.fn()} />);
    expect(screen.getByText(/folded · click to show/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("says an open column is open", () => {
    render(<SheetBand group={group()} onFold={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Review/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText(/folded · click to show/)).toBeNull();
  });

  it("has no add button on a column you can't type into", () => {
    render(<SheetBand group={group()} onFold={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Add a card|Start a thread/ })).toBeNull();
  });

  it("offers to add a card to the Backlog", () => {
    const onAdd = vi.fn();
    render(<SheetBand group={group({ column: "backlog", label: "Backlog" })} onFold={vi.fn()} onAdd={onAdd} />);
    const add = screen.getByRole("button", { name: "Add a card to the Backlog" });
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalled();
    expect(screen.getByText(/Add/)).toBeInTheDocument();
  });

  it("offers to start a thread in Running", () => {
    const onAdd = vi.fn();
    render(<SheetBand group={group({ column: "running", label: "Running" })} onFold={vi.fn()} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Start a thread in Running" }));
    expect(onAdd).toHaveBeenCalled();
    expect(screen.getByText(/Start/)).toBeInTheDocument();
  });

  it("colours the band by its column", () => {
    const { container } = render(<SheetBand group={group({ column: "done", label: "Done" })} onFold={vi.fn()} />);
    expect(container.querySelector(".sheet-band")).toHaveClass("text-faint");
  });
});

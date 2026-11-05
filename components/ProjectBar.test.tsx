// @vitest-environment jsdom
//
// The project bar's row, and the view toast that hangs under the board/list toggle. The toast is
// keyed on the flip's id, so a second flip remounts it and its entrance plays again — that is the
// behaviour this file pins down, along with the toast's own dismissal.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

import { setBoardMode } from "@/lib/board-prefs";
import ProjectBar from "./ProjectBar";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof ProjectBar>> = {}) {
  const props: React.ComponentProps<typeof ProjectBar> = {
    projects: [],
    total: 3,
    selected: null,
    onSelect: vi.fn(),
    filter: null,
    sort: "newest",
    onSort: vi.fn(),
    view: "board",
    onView: vi.fn(),
    viewHint: null,
    onDismissViewHint: vi.fn(),
    home: "/h",
    onMenuOpenChange: vi.fn(),
    ...over,
  };
  const { rerender } = render(<ProjectBar {...props} />);
  return { props, rerender };
}

describe("ProjectBar's view toast", () => {
  it("draws nothing when there is no hint", () => {
    setup();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("draws the toast for the view that was flipped to", () => {
    setup({ viewHint: { mode: "list", id: 1 } });
    expect(screen.getByRole("status")).toHaveTextContent("List view");
  });

  it("remounts the toast on a second flip, so its entrance plays again", () => {
    const { props, rerender } = setup({ viewHint: { mode: "list", id: 1 } });
    const first = screen.getByRole("status");

    // The same view, a new flip: the id is what makes it a new toast.
    rerender(<ProjectBar {...props} viewHint={{ mode: "list", id: 2 }} />);
    const second = screen.getByRole("status");
    expect(second).not.toBe(first);
  });

  it("closes on the toast's own ✕", () => {
    const onDismissViewHint = vi.fn();
    setup({ viewHint: { mode: "list", id: 1 }, onDismissViewHint });
    screen.getByLabelText("Dismiss").click();
    expect(onDismissViewHint).toHaveBeenCalled();
  });
});

describe("ProjectBar in Regular mode", () => {
  it("drops the view toggle and the sort", () => {
    setBoardMode("regular");
    setup();
    expect(screen.queryByLabelText("Sort cards")).toBeNull();
    expect(screen.queryByRole("button", { name: /list/i })).toBeNull();
    expect(screen.getByText("More")).toBeInTheDocument();
    document.cookie = "weft-board-mode=; path=/; max-age=0";
  });
});

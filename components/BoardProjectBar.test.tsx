// @vitest-environment jsdom
// The project bar's wiring: ProjectBar gets the projects and sort, and its filter slot holds the rail
// chip and the filter box, which lists matches only while a query is typed and searches all with it.

import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";

type Props = Record<string, unknown>;
const seen = new Map<string, Props>();
vi.mock("./ProjectBar", () => ({
  default: (p: Props & { filter: ReactNode }) => {
    seen.set("bar", p);
    return <div>{p.filter}</div>;
  },
}));
vi.mock("./FilterBox", () => ({ default: (p: Props) => (seen.set("box", p), null) }));
vi.mock("./RailFilterChip", () => ({ default: (p: Props) => (seen.set("chip", p), null) }));

import { topMatches } from "@/lib/board-view";
import BoardProjectBar, { type BoardProjectBarProps } from "./BoardProjectBar";

afterEach(() => {
  cleanup();
  seen.clear();
});

const card = (id: string, title: string): Card => ({ id, title, column: "running", cwd: "/r", updatedAt: 0 }) as Card;

function setup(over: Partial<BoardProjectBarProps> = {}) {
  const props: BoardProjectBarProps = {
    projects: [],
    total: 3,
    project: "/p",
    onProject: vi.fn(),
    railFilter: { starred: true },
    onRailFilter: vi.fn(),
    query: "",
    onQuery: vi.fn(),
    byColumn: new Map<Column, Card[]>([["running", [card("a", "fix login"), card("b", "docs")]]]),
    onOpenCard: vi.fn(),
    onSearchAll: vi.fn(),
    sort: "recent" as BoardProjectBarProps["sort"],
    onSort: vi.fn(),
    home: "/h",
    onMenuOpenChange: vi.fn(),
    ...over,
  };
  render(<BoardProjectBar {...props} />);
  return props;
}

describe("BoardProjectBar", () => {
  it("hands ProjectBar the projects, selection, sort and menu callback", () => {
    const p = setup();
    const bar = seen.get("bar")!;
    expect(bar).toMatchObject({ total: 3, selected: "/p", onSelect: p.onProject, sort: "recent", onSort: p.onSort, home: "/h", onMenuOpenChange: p.onMenuOpenChange });
    expect(seen.get("chip")).toMatchObject({ filter: p.railFilter, onClear: p.onRailFilter });
  });

  it("lists no matches for a blank query", () => {
    setup({ query: "  " });
    expect(seen.get("box")!.matches).toEqual([]);
  });

  it("lists the ranked cards while typing, and searches all with the query", () => {
    const p = setup({ query: "login" });
    const box = seen.get("box")!;
    // The board's own ranking (lib/board-view.ts), cut to the filter box's few.
    expect(box.matches).toEqual(topMatches(p.byColumn, 5, "login"));
    expect(box.matches).not.toEqual([]);
    expect(box.onOpen).toBe(p.onOpenCard);
    expect(box.onQuery).toBe(p.onQuery);
    (box.onSearchAll as () => void)();
    expect(p.onSearchAll).toHaveBeenCalledWith("login");
  });
});

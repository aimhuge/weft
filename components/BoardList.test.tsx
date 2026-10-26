// @vitest-environment jsdom
// The list view: every card the board shows on one sheet, one row each, in the board's column
// order. CardRow is stubbed, so this pins what the list itself decides — the order and the rows.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card, Column } from "@/lib/types";
import { makeCard } from "./test-utils";
import { listProps, recordRow, rows } from "./board-list.harness";

const seen: { card: Card; column: Column }[] = [];
vi.mock("./CardRow", () => ({
  default: (p: { card: Card; column: Column }) => <div data-card-id={p.card.id}>{p.card.title}</div>,
}));

const api = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve({ card: {} })),
  settings: vi.fn(() => Promise.resolve({ defaultBackend: "puku" })),
}));
vi.mock("@/lib/client", () => ({ api }));
// The crons the sheet's ⏰ band shows, set per test, and the calls its menu makes.
const crons = vi.hoisted(() => ({ list: [] as unknown[], update: vi.fn(() => Promise.resolve()), run: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/use-crons", () => ({ useCrons: () => ({ crons: crons.list, update: crons.update, run: crons.run }) }));

import BoardList, { type BoardListProps } from "./BoardList";

afterEach(() => {
  cleanup();
  seen.length = 0;
  window.localStorage.clear();
  crons.list = [];
});

function setup(over: Partial<BoardListProps> = {}) {
  const props = listProps({ ...over, renderRow: over.renderRow ?? recordRow((card, column) => seen.push({ card, column })) });
  return { props, view: render(<BoardList {...props} />) };
}

describe("BoardList", () => {
  it("draws every card the board shows, in column order", () => {
    setup();
    // The age clock starts after mount and draws the sheet once more; the last pass is what shows.
    expect(seen.slice(-2).map((r) => [r.card.id, r.column])).toEqual([
      ["r1", "running"],
      ["d1", "done"],
    ]);
  });

  it("keeps a Backlog and a Running band to type into on an empty board", () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>() });
    expect(view.getByRole("button", { name: /^Backlog/ })).toBeInTheDocument();
    expect(view.getByLabelText("Start a thread")).toBeInTheDocument();
  });

  it("heads each column, so the eye knows which group it is in", () => {
    const { view } = setup();
    expect(view.getByText("Running")).toBeInTheDocument();
    expect(view.getByText("Done")).toBeInTheDocument();
  });

  it("leaves out a column with no cards", () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["running", [makeCard({ id: "r1" })]]]) });
    expect(view.getByText("Running")).toBeInTheDocument();
    expect(view.queryByText("Review")).toBeNull();
  });

  it("opens New thread on a double-click in empty space", () => {
    const { props, view } = setup();
    // The sheet itself is empty space: no card, button or control under the pointer.
    fireEvent.doubleClick(view.container.querySelector("main")!);
    expect(props.onNew).toHaveBeenCalled();
  });

  it("opens New thread from the sheet's corner and a quick add's More…", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByLabelText("New thread"));
    fireEvent.click(view.getByRole("button", { name: "More…" }));
    expect(props.onNew).toHaveBeenCalledTimes(2);
  });

  it("files a Backlog card from just its title, and keeps the cursor for the next one", async () => {
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["running", [makeCard({ cwd: "/dev/weft" })]]]) });
    fireEvent.click(view.getByRole("button", { name: "Add a card to the Backlog" }));
    const box = view.getByLabelText("New Backlog card title");
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "Dark mode for the sheet" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await vi.waitFor(() => expect(view.getByText("✓ 1 added")).toBeInTheDocument());
    expect(api.create).toHaveBeenCalledWith({ title: "Dark mode for the sheet", prompt: "Dark mode for the sheet", start: false, cwd: "/dev/weft", backend: "puku" });
    expect(box).toHaveValue("");
  });

  it("starts a thread from the Running band's quick add, and gives the words back if it fails", async () => {
    const notify = vi.fn();
    api.create.mockRejectedValueOnce(new Error("no"));
    const { view } = setup({ notify, byColumn: new Map<Column, Card[]>([["running", [makeCard({ cwd: "/dev/weft" })]]]) });
    const box = view.getByLabelText("Start a thread");
    fireEvent.change(box, { target: { value: "fix the tests" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(api.create).toHaveBeenLastCalledWith({ prompt: "fix the tests", start: true, cwd: "/dev/weft", backend: "puku" });
    expect(box).toHaveValue("fix the tests");
  });

  it("leaves a double-click on a row alone", () => {
    const { props, view } = setup();
    fireEvent.doubleClick(view.getByText("Running one"));
    expect(props.onNew).not.toHaveBeenCalled();
  });

  it("numbers its rows down the whole sheet, like a spreadsheet", () => {
    const { view } = setup();
    const numbers = [...view.container.querySelectorAll(".sheet-gutter")].map((el) => el.textContent).filter((t) => /\d/.test(t));
    expect(numbers).toEqual(["1", "2"]);
  });

  it("puts the Backlog first, folded to start with, then what needs you", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([
        ["backlog", [makeCard({ id: "b", title: "Later" })]],
        ["review", [makeCard({ id: "v", title: "Look" })]],
        ["needs_you", [makeCard({ id: "n", title: "Answer me", column: "needs_you" })]],
      ]),
    });
    const bands = [...view.container.querySelectorAll(".sheet-band")].map((b) => b.textContent);
    expect(bands.map((b) => b.split(/\d/)[0])).toEqual(["Backlog", "Needs you", "Running", "Review"]);
    expect(rows(view.container)).toEqual(["Answer me", "Look"]);
    fireEvent.click(view.getByRole("button", { name: /^Backlog/ }));
    expect(rows(view.container)).toEqual(["Later", "Answer me", "Look"]);
    fireEvent.click(view.getByRole("button", { name: /^Review/ }));
    expect(rows(view.container)).toEqual(["Later", "Answer me"]);
  });

  it("filters titles as you type, straight from a click on the Title header", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([["review", [makeCard({ id: "a", title: "Fix the sheet" }), makeCard({ id: "b", title: "Ship themes" })]]]),
    });
    fireEvent.click(view.getByTitle(/Filter or sort by title/));
    const box = view.getByPlaceholderText("Type to filter titles…");
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "sheet" } });
    expect(rows(view.container)).toEqual(["Fix the sheet"]);
    expect(view.getByText("1 card matches")).toBeInTheDocument();
    expect(view.getByText("“sheet”")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByLabelText("Clear filters"));
    expect(rows(view.container)).toEqual(["Fix the sheet", "Ship themes"]);
  });

  it("narrows a column's values as you type, and Enter keeps only what matched", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([
        ["review", [makeCard({ id: "b", title: "Bug one", tags: ["bug"] }), makeCard({ id: "u", title: "UI one", tags: ["ui"] }), makeCard({ id: "x", title: "Build", tags: ["build"] })]],
      ]),
    });
    fireEvent.click(view.getByTitle(/Filter or sort by tags/));
    const box = view.getByPlaceholderText("Type to filter tags…");
    fireEvent.change(box, { target: { value: "bu" } });
    expect(view.getAllByRole("option").map((o) => o.textContent.replace(/Only\d+$/, ""))).toEqual(["bug", "build"]);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(rows(view.container)).toEqual(["Build"]);
    expect(view.getByText("build")).toBeInTheDocument();
  });

  it("ticks values, keeps only one, shows or hides them all, and nothing-matches says so", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([["review", [makeCard({ id: "b", title: "Bug one", tags: ["bug"] }), makeCard({ id: "u", title: "UI one", tags: ["ui"] })]]]),
    });
    fireEvent.click(view.getByTitle(/Filter or sort by tags/));
    fireEvent.click(view.getByRole("checkbox", { name: "bug" }));
    expect(rows(view.container)).toEqual(["UI one"]);
    expect(view.getByText("1 of 2 shown")).toBeInTheDocument();
    fireEvent.click(view.getAllByRole("button", { name: "Only" })[0] as HTMLElement);
    expect(rows(view.container)).toEqual(["Bug one"]);
    fireEvent.click(view.getByRole("button", { name: "Hide all" }));
    expect(view.getByText("No cards match these filters.")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Show all" }));
    expect(rows(view.container)).toEqual(["Bug one", "UI one"]);
    fireEvent.change(view.getByPlaceholderText("Type to filter tags…"), { target: { value: "zzz" } });
    expect(view.getByText("Nothing matches “zzz”")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("flips the age sort with one click, and sorts from a menu's buttons, kept for next time", () => {
    const { view } = setup({
      byColumn: new Map<Column, Card[]>([
        ["review", [makeCard({ id: "o", title: "old", updatedAt: 1000 }), makeCard({ id: "n", title: "new", updatedAt: 9000 })]],
      ]),
    });
    fireEvent.click(view.getByTitle(/Sort by age/));
    expect(rows(view.container)).toEqual(["new", "old"]);
    fireEvent.click(view.getByTitle(/Sort by age/));
    expect(rows(view.container)).toEqual(["old", "new"]);
    fireEvent.click(view.getByTitle(/Filter or sort by title/));
    fireEvent.click(view.getByRole("button", { name: /A → Z/ }));
    expect(rows(view.container)).toEqual(["new", "old"]);
    expect(JSON.parse(window.localStorage.getItem("weft:list-sheet") ?? "{}")).toMatchObject({ sort: { key: "title", dir: "asc" } });
    fireEvent.click(view.getByRole("button", { name: /A → Z/ }));
    expect(JSON.parse(window.localStorage.getItem("weft:list-sheet") ?? "{}")).toMatchObject({ sort: null });
    fireEvent.mouseDown(document.body);
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("folds a card open to its subagents and the cards it started", () => {
    const parent = makeCard({
      id: "p",
      title: "Parent",
      tasks: [{ id: "t1", kind: "agent", description: "Explore the sheet", subagentType: "Explore", status: "running", startedAt: 1 }],
    });
    const child = makeCard({ id: "k", title: "Child", parentId: "p", column: "running" });
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["running", [parent, child]]]) });
    expect(rows(view.container)).toEqual(["Parent"]);
    fireEvent.click(view.getByLabelText("Fold Parent"));
    expect(rows(view.container)).toEqual(["Parent", "Child"]);
    expect(view.getByText("Explore the sheet")).toBeInTheDocument();
    expect(view.container.querySelector("[data-card-id=k]")).toHaveAttribute("data-depth", "1");
    fireEvent.click(view.getByLabelText("Fold Parent"));
    expect(view.queryByText("Explore the sheet")).toBeNull();
  });

  it("lists the crons in a band at the foot, runs one or switches it off, and folds open its runs", () => {
    const run = makeCard({ id: "run2", title: "Nightly sweep · run 2", column: "review", cronId: "k1", cronRun: 2, cronOf: "src" });
    crons.list = [
      { id: "k1", name: "Nightly sweep", prompt: "sweep", expr: "0 9 * * *", mode: "fork", cwd: "/dev/weft", backend: "claude", permissionMode: "default", enabled: true, by: "thread", count: 2, runs: [{ cardId: "run2", n: 2, at: Date.now() - 3_600_000 }], nextAt: Date.now() + 3 * 3_600_000, createdAt: 1, updatedAt: 1 },
      { id: "k2", name: "Weekly report", prompt: "report", expr: "0 9 * * 1", mode: "fresh", cwd: "/dev/blastcp", backend: "claude", permissionMode: "default", enabled: false, by: "you", count: 0, runs: [], createdAt: 1, updatedAt: 1 },
    ];
    const { view } = setup({ byColumn: new Map<Column, Card[]>([["review", [run]]]) });
    expect(view.getByText("Nightly sweep")).toBeInTheDocument();
    expect(view.getByText("On · in 3h")).toBeInTheDocument();
    expect(view.getByText("every day at 9:00")).toBeInTheDocument();
    expect(view.getByText("by a thread")).toBeInTheDocument();
    expect(view.getByText("Off")).toBeInTheDocument();
    fireEvent.click(view.getByLabelText("Show the runs of Nightly sweep"));
    expect(rows(view.container).filter((t) => t === "Nightly sweep · run 2")).toHaveLength(2);
    fireEvent.click(view.getByLabelText("Fold the runs of Nightly sweep"));
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Run now/ }));
    expect(crons.run).toHaveBeenCalledWith("k1");
    fireEvent.contextMenu(view.getByLabelText("Weekly report: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Switch on/ }));
    expect(crons.update).toHaveBeenCalledWith("k2", { enabled: true });
    fireEvent.click(view.getByRole("button", { name: /^Crons/ }));
    expect(view.queryByText("Weekly report")).toBeNull();
  });

  it("filters the crons by the title search, and leaves the band out when none match", () => {
    crons.list = [{ id: "k1", name: "Nightly sweep", prompt: "p", expr: "0 9 * * *", mode: "fresh", cwd: "/x", backend: "claude", permissionMode: "default", enabled: true, by: "you", count: 0, runs: [], createdAt: 1, updatedAt: 1 }];
    const { view } = setup();
    fireEvent.click(view.getByTitle(/Filter or sort by title/));
    fireEvent.change(view.getByPlaceholderText("Type to filter titles…"), { target: { value: "zzz" } });
    expect(view.queryByText("Nightly sweep")).toBeNull();
  });

  it("gives a cron's run its ⏰ badge through the row's nest", () => {
    const seenNest: unknown[] = [];
    crons.list = [{ id: "k1", name: "Nightly sweep", prompt: "p", expr: "0 9 * * *", mode: "fresh", cwd: "/x", backend: "claude", permissionMode: "default", enabled: true, by: "you", count: 3, runs: [], createdAt: 1, updatedAt: 1 }];
    setup({
      byColumn: new Map<Column, Card[]>([["review", [makeCard({ id: "r3", cronId: "k1", cronRun: 3, cronOf: "r1" })]]]),
      renderRow: (card, _column, nest) => {
        seenNest.push(nest?.cron);
        return <div data-card-id={card.id}>{card.title}</div>;
      },
    });
    expect(seenNest.at(-1)).toMatchObject({ text: "run 3" });
  });
});

// @vitest-environment jsdom
// A row of the list view: the card's facts on one line — its column, title, status and stage — with
// the card's own actions, so a row is as usable as a card.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";

import CardRow from "./CardRow";

afterEach(cleanup);

type CardRowProps = React.ComponentProps<typeof CardRow>;

function setup(over: Parameters<typeof makeCard>[0] = {}, handlers: Partial<CardRowProps> = {}) {
  const card = makeCard(over);
  const props: CardRowProps = {
    card,
    column: card.column,
    now: Date.now(),
    selected: false,
    onOpen: vi.fn(),
    ...handlers,
  };
  const view = render(<CardRow {...props} />);
  return { card, props, view };
}

describe("CardRow", () => {
  it("shows the card's title", () => {
    setup({ title: "Fix the login page", column: "review" });
    expect(screen.getByText("Fix the login page")).toBeInTheDocument();
  });

  it("opens the card on a click", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByText("Fix the login page"));
    expect(props.onOpen).toHaveBeenCalled();
  });

  it("says when a card needs you", () => {
    setup({ column: "needs_you" });
    // The column heading carries the column; the row says what it wants.
    expect(screen.getByText("Needs you")).toBeInTheDocument();
  });

  it("shows an error card's error", () => {
    setup({ error: "build failed on main" });
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows the card's stage", () => {
    setup({ stage: "Going deeper", column: "running" });
    expect(screen.getByText("Going deeper")).toBeInTheDocument();
  });

  it("shows what's left of the card's work", () => {
    setup({ stage: "Polishing", remaining: "write the docs", column: "running" });
    expect(screen.getByText("· write the docs")).toBeInTheDocument();
  });

  it("carries the card's own actions", () => {
    const onStar = vi.fn();
    setup({ starred: true }, { onStar });
    fireEvent.click(screen.getByLabelText("Starred"));
    expect(onStar).toHaveBeenCalled();
  });

  it("stops a running thread from its row", () => {
    const onStop = vi.fn();
    setup({ column: "running", backend: "claude" }, { onStop });
    fireEvent.click(screen.getByLabelText("Stop this thread"));
    expect(onStop).toHaveBeenCalled();
  });

  it("underlines the title as a link and folds open what is under it", () => {
    const onToggle = vi.fn();
    const { view, props } = setup({ title: "Parent" }, { nest: { depth: 1, kids: 3, expanded: false, onToggle } });
    expect(view.getByText("Parent")).toHaveClass("sheet-title");
    fireEvent.click(view.getByLabelText("Show what's under this card"));
    expect(onToggle).toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("opens a status menu on a click or a right-click, and runs what you pick", () => {
    const onMove = vi.fn();
    const onContextMenu = vi.fn();
    const { view, props } = setup({ column: "backlog" }, { onMove, onContextMenu });
    fireEvent.contextMenu(view.getByLabelText("Status: what this card can do"));
    expect(onContextMenu).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("menuitem", { name: /Run now/ }));
    expect(onMove).toHaveBeenCalledWith("running");
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Move to Review/ }));
    expect(onMove).toHaveBeenLastCalledWith("review");
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Open the thread/ }));
    expect(props.onOpen).toHaveBeenCalled();
  });

  it("stops, continues and restarts from the status menu", () => {
    const onStop = vi.fn();
    const onResume = vi.fn();
    const running = setup({ column: "running" }, { onStop });
    fireEvent.click(running.view.getByLabelText("Running: what this card can do"));
    fireEvent.click(running.view.getByRole("menuitem", { name: /Stop/ }));
    expect(onStop).toHaveBeenCalled();
    cleanup();
    const stopped = setup({ column: "review", sessionId: "s", lastLine: "Stopped by you" }, { onResume });
    fireEvent.click(stopped.view.getByLabelText("Status: what this card can do"));
    fireEvent.click(stopped.view.getByRole("menuitem", { name: /Continue/ }));
    fireEvent.click(stopped.view.getByLabelText("Status: what this card can do"));
    fireEvent.click(stopped.view.getByRole("menuitem", { name: /Restart/ }));
    expect(onResume.mock.calls).toEqual([["continue"], ["restart"]]);
  });

  it("moves the card to another folder from a type-ahead picker", () => {
    const onFolder = vi.fn();
    const { view } = setup({ cwd: "/dev/weft" }, { onFolder, folders: ["/dev/weft", "/dev/blastcp", "/dev/groovenfill"] });
    fireEvent.click(view.getByText("weft"));
    const box = view.getByPlaceholderText("Type a folder name or path…");
    fireEvent.change(box, { target: { value: "blast" } });
    expect(view.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onFolder).toHaveBeenCalledWith("/dev/blastcp");
  });

  it("takes a folder path typed in full, and leaves the folder alone without a mover", () => {
    const onFolder = vi.fn();
    const { view } = setup({ cwd: "/dev/weft" }, { onFolder, folders: ["/dev/weft"] });
    fireEvent.click(view.getByText("weft"));
    fireEvent.change(view.getByPlaceholderText("Type a folder name or path…"), { target: { value: "/tmp/new-thing" } });
    fireEvent.click(view.getByText("/tmp/new-thing"));
    expect(onFolder).toHaveBeenCalledWith("/tmp/new-thing");
    cleanup();
    const still = setup({ cwd: "/dev/weft" });
    expect(still.view.queryByRole("button", { name: "weft" })).toBeNull();
  });
});

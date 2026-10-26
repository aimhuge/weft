// @vitest-environment jsdom
// A list-view row's status cell: what the thread is doing, and the menu of what it can do right now.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingPermission } from "@/lib/types-card";
import RowStatusCell from "./RowStatusCell";
import { makeCard } from "./test-utils";
import "./test-utils";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof RowStatusCell>> = {}, card = makeCard({ id: "c1" })) {
  const props: React.ComponentProps<typeof RowStatusCell> = { card, column: card.column, onAction: vi.fn(), ...over };
  return { props, view: render(<RowStatusCell {...props} />) };
}

describe("RowStatusCell", () => {
  it("says a card with nothing to say is just its column", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "review" }));
    expect(view.getByLabelText("Status: what this card can do")).toBeInTheDocument();
    expect(view.getByTitle("Stop, run or move this card")).toBeInTheDocument();
  });

  it("says the thread is running", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "running" }));
    expect(view.getByText("Running")).toBeInTheDocument();
    expect(view.getByLabelText("Running: what this card can do")).toBeInTheDocument();
  });

  it("says a card needs you", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "needs_you", lastLine: "which database?" }));
    expect(view.getByText("Needs you")).toBeInTheDocument();
    expect(view.getByTitle("which database?")).toBeInTheDocument();
  });

  it("says a card that failed, and shows its error", () => {
    const { view } = setup({}, makeCard({ id: "c1", error: "build failed on main" }));
    expect(view.getByText("Error")).toBeInTheDocument();
    expect(view.getByTitle("build failed on main")).toBeInTheDocument();
  });

  it("says a card is waiting on another card's code", () => {
    const pending: PendingPermission = { id: "p1", toolName: "Bash", title: "Run npm test", input: {}, waiting: true };
    const { view } = setup({}, makeCard({ id: "c1", column: "running", pending }));
    expect(view.getByText("Waiting")).toBeInTheDocument();
  });

  it("says a card is asking a question", () => {
    const pending: PendingPermission = { id: "p1", toolName: "AskUserQuestion", title: "Which database?", input: {}, questions: [{ header: "DB", question: "Which?", options: [{ label: "a" }] }] };
    const { view } = setup({}, makeCard({ id: "c1", column: "running", pending }));
    expect(view.getByText("Question")).toBeInTheDocument();
  });

  it("says a card is asking for permission", () => {
    const pending: PendingPermission = { id: "p1", toolName: "Bash", title: "Run npm test", input: {} };
    const { view } = setup({}, makeCard({ id: "c1", column: "running", pending }));
    expect(view.getByText("Permission")).toBeInTheDocument();
  });

  it("opens the menu on a click", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    expect(view.getByRole("menuitem", { name: /Run now/ })).toBeInTheDocument();
  });

  it("opens the menu on a right-click", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.contextMenu(view.getByLabelText("Status: what this card can do"));
    expect(view.getByRole("menuitem", { name: /Run now/ })).toBeInTheDocument();
  });

  it("runs what you pick, and closes the menu", () => {
    const { props, view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Run now/ }));
    expect(props.onAction).toHaveBeenCalledWith("run");
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("offers to stop a running thread", () => {
    const { props, view } = setup({}, makeCard({ id: "c1", column: "running" }));
    fireEvent.click(view.getByLabelText("Running: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Stop/ }));
    expect(props.onAction).toHaveBeenCalledWith("stop");
  });

  it("offers to move a card to the Backlog, and to Review from a column that isn't it", () => {
    const { props, view } = setup({}, makeCard({ id: "c1", column: "review" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Move to Backlog/ }));
    expect(props.onAction).toHaveBeenCalledWith("move:backlog");
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    expect(view.queryByRole("menuitem", { name: /Move to Review/ })).toBeNull();
  });

  it("offers to move a card to the Review, and not to the Backlog it sits in", () => {
    const { props, view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Move to Review/ }));
    expect(props.onAction).toHaveBeenCalledWith("move:review");
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    expect(view.queryByRole("menuitem", { name: /Move to Backlog/ })).toBeNull();
  });

  it("offers to continue and restart a thread that has a session", () => {
    const { props, view } = setup({}, makeCard({ id: "c1", column: "review", sessionId: "s1", lastLine: "Stopped" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.click(view.getByRole("menuitem", { name: /Continue/ }));
    expect(props.onAction).toHaveBeenCalledWith("continue");
  });

  it("shows what a menu item does", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    expect(view.getByText("Start its first message")).toBeInTheDocument();
  });

  it("marks the dangerous item", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "running" }));
    fireEvent.click(view.getByLabelText("Running: what this card can do"));
    expect(view.getByRole("menuitem", { name: /Stop/ })).toHaveClass("text-danger");
  });

  it("closes the menu when the popover closes", () => {
    const { view } = setup({}, makeCard({ id: "c1", column: "backlog" }));
    fireEvent.click(view.getByLabelText("Status: what this card can do"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("menu")).toBeNull();
  });
});

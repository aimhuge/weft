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
});

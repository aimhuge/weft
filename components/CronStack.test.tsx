// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";
import CronMark, { cronCardClass } from "./CronMark";
import CronStack from "./CronStack";
import { makeCard } from "./test-utils";

// A card with a cron's runs folded under it (components/CronStack.tsx): the first click fans the runs out instead of
// opening the card; once open, clicks reach the card again and the chip folds them back.

function face(onOpen: (card: Card) => void) {
  return function Face(card: Card) {
    return (
    <div data-card-id={card.id} role="button" tabIndex={0} onClick={() => onOpen(card)}>
      {card.title}
      <button type="button" onClick={() => onOpen({ ...card, title: "star" })}>☆</button>
    </div>
    );
  };
}

const holder = makeCard({ id: "src", title: "Morning digest" });
const runs = [makeCard({ id: "r2", title: "Run two", cronId: "x", cronRun: 2 }), makeCard({ id: "r1", title: "Run one", cronId: "x", cronRun: 1 })];

describe("CronStack", () => {
  it("fans the runs out on the first click, without opening the card", () => {
    const onOpen = vi.fn();
    render(<CronStack holder={holder} runs={runs} renderCard={face(onOpen)} />);
    expect(screen.queryByText("Run two")).toBeNull();
    fireEvent.click(screen.getByText("Morning digest"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Runs of Morning digest")).toHaveTextContent(/Run two.*Run one/);
  });

  it("opens the card on a click once the runs are out, and opens a run's own card", () => {
    const onOpen = vi.fn();
    render(<CronStack holder={holder} runs={runs} renderCard={face(onOpen)} />);
    fireEvent.click(screen.getByText("Morning digest"));
    fireEvent.click(screen.getByText("Morning digest"));
    fireEvent.click(screen.getByText("Run one"));
    expect(onOpen.mock.calls.map((call) => (call[0] as Card).id)).toEqual(["src", "r1"]);
  });

  it("lets the card's own buttons through while folded", () => {
    const onOpen = vi.fn();
    render(<CronStack holder={holder} runs={runs} renderCard={face(onOpen)} />);
    fireEvent.click(screen.getAllByText("☆")[0] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: "star" }));
    expect(screen.queryByText("Run two")).toBeNull();
  });

  it("folds the runs back from its chip, which counts them", () => {
    render(<CronStack holder={holder} runs={runs.slice(1)} renderCard={face(vi.fn())} />);
    const chip = screen.getByRole("button", { name: /1 run ▾/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Run one")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByText("Run one")).toBeNull();
  });
});

describe("CronMark", () => {
  it("marks a run with ⏰ and its number, and gives its card the ticket stub", () => {
    render(<CronMark card={{ cronId: "x", cronRun: 3 }} />);
    expect(screen.getByText("run 3")).toBeInTheDocument();
    expect(cronCardClass({ cronId: "x" })).toBe("cron-stub");
  });

  it("draws nothing on a card that isn't a run", () => {
    const { container } = render(<CronMark card={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(cronCardClass({})).toBe("");
  });
});

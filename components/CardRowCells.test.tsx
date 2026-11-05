// @vitest-environment jsdom
// The cells of a list-view row: the title with its fold toggle, the stage, the tags, the age and the
// card's own buttons.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";
import { ActionsCell, AgeCell, Chevron, StageCell, TagsCell, TitleCell, type RowNest } from "./CardRowCells";
import { makeCard } from "./test-utils";
import "./test-utils";

const api = vi.hoisted(() => ({ clearBreak: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/client", () => ({ api }));

const NOW = new Date(2025, 2, 12, 9, 0, 0, 0).getTime();

describe("Chevron", () => {
  it("points right when shut", () => {
    const view = render(<Chevron open={false} />);
    expect(view.container.querySelector("svg")).not.toHaveClass("rotate-90");
  });

  it("points down when open", () => {
    const view = render(<Chevron open={true} />);
    expect(view.container.querySelector("svg")).toHaveClass("rotate-90");
  });
});

describe("TitleCell", () => {
  it("says what the card is", () => {
    const view = render(<TitleCell card={makeCard({ title: "Fix the login page" })} unseen={false} />);
    expect(view.getByTitle("Fix the login page")).toBeInTheDocument();
  });

  it("marks a card you haven't looked at", () => {
    const view = render(<TitleCell card={makeCard()} unseen={true} />);
    expect(view.getByTitle("New since you last looked")).toBeInTheDocument();
  });

  it("leaves a looked-at card unmarked", () => {
    const view = render(<TitleCell card={makeCard()} unseen={false} />);
    expect(view.queryByTitle("New since you last looked")).toBeNull();
  });

  it("has no fold toggle when nothing folds under it", () => {
    const view = render(<TitleCell card={makeCard()} unseen={false} />);
    expect(view.queryByRole("button")).toBeNull();
  });

  it("offers to show what folds under it", () => {
    const onToggle = vi.fn();
    const nest: RowNest = { depth: 0, kids: 2, expanded: false, onToggle };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    const fold = view.getByRole("button", { name: "Show what's under this card" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold).toHaveAttribute("title", "2 under this card");
    fireEvent.click(fold);
    expect(onToggle).toHaveBeenCalled();
  });

  it("offers to fold it back up", () => {
    const nest: RowNest = { depth: 0, kids: 2, expanded: true, onToggle: vi.fn() };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    expect(view.getByRole("button", { name: "Fold what's under this card" })).toHaveAttribute("aria-expanded", "true");
  });

  it("indents a nested card", () => {
    const nest: RowNest = { depth: 2, kids: 0, expanded: false, onToggle: vi.fn() };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    const holder = view.container.querySelector("span.flex.min-w-0") as HTMLElement;
    expect(holder.style.paddingLeft).toBe("36px");
  });

  it("keeps a done card's title muted", () => {
    const view = render(<TitleCell card={makeCard({ column: "done" })} unseen={false} />);
    expect(view.getByTitle("Fix the login page")).toHaveClass("text-muted");
  });

  it("carries a cron's badge", () => {
    const nest: RowNest = { depth: 0, kids: 0, expanded: false, onToggle: vi.fn(), cron: { text: "next in 5m", tip: "Nightly sweep: every day, 2 runs" } };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    expect(view.getByTitle("Nightly sweep: every day, 2 runs")).toHaveTextContent("⏰ next in 5m");
  });

  it("marks a cron that's off", () => {
    const nest: RowNest = { depth: 0, kids: 0, expanded: false, onToggle: vi.fn(), cron: { text: "off", tip: "Nightly sweep: every day, 2 runs (off)", off: true } };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    expect(view.getByTitle(/off/)).toHaveClass("sheet-cron-off");
  });

  it("has no badge when the card holds no cron", () => {
    const nest: RowNest = { depth: 0, kids: 0, expanded: false, onToggle: vi.fn(), cron: null };
    const view = render(<TitleCell card={makeCard()} unseen={false} nest={nest} />);
    expect(view.queryByText(/⏰/)).toBeNull();
  });
});

describe("StageCell", () => {
  it("says nothing for a card with no stage", () => {
    const view = render(<StageCell card={makeCard()} column="review" />);
    expect(view.container.textContent).toBe("");
  });

  it("says nothing left when the stage is done and nothing is left", () => {
    const view = render(<StageCell card={makeCard({ stage: "Done", remaining: "none" })} column="done" />);
    expect(view.getByText("Done")).toBeInTheDocument();
    expect(view.queryByText(/· tests/)).toBeNull();
  });

  it("says the stage the card has reached", () => {
    const view = render(<StageCell card={makeCard({ stage: "First shot" })} column="review" />);
    expect(view.getByText("First shot")).toBeInTheDocument();
  });

  it("draws a dot for each stage, up to the one it reached", () => {
    const view = render(<StageCell card={makeCard({ stage: "First shot" })} column="review" />);
    expect(view.getByTitle("First shot: step 3 of 8")).toBeInTheDocument();
    expect(view.container.querySelectorAll(".list-stage-dots span")).toHaveLength(8);
  });

  it("draws no dots for a stage it doesn't know", () => {
    const view = render(<StageCell card={makeCard({ stage: "Nonsense" })} column="review" />);
    expect(view.queryByTitle(/step/)).toBeNull();
  });

  it("says what's left of it", () => {
    const view = render(<StageCell card={makeCard({ stage: "First shot", remaining: "tests" })} column="review" />);
    expect(view.getByText(/· tests/)).toHaveAttribute("title", "Left: tests");
  });

  it("says what's left even with no stage", () => {
    const view = render(<StageCell card={makeCard({ remaining: "tests" })} column="review" />);
    expect(view.getByTitle("Left: tests")).toBeInTheDocument();
  });
});

describe("TagsCell", () => {
  it("says the card's tags", () => {
    const view = render(<TagsCell card={makeCard({ tags: ["api", "auth"] })} />);
    expect(view.getByText("api")).toBeInTheDocument();
  });

  it("filters the list down to the tag you click", () => {
    const onTag = vi.fn();
    const view = render(<TagsCell card={makeCard({ tags: ["api"] })} onTag={onTag} />);
    fireEvent.click(view.getByText("api"));
    expect(onTag).toHaveBeenCalledWith("api");
  });

  it("puts a break of Weft's own on the card", () => {
    const view = render(<TagsCell card={makeCard({ broke: { kind: "server", at: NOW, why: "its pnpm dev stopped Weft" } })} />);
    expect(view.getByText(/Broke Weft/)).toBeInTheDocument();
  });

  it("takes the break back when you dismiss it", () => {
    api.clearBreak.mockClear();
    const view = render(<TagsCell card={makeCard({ id: "c9", broke: { kind: "build", at: NOW, why: "it broke the build" } })} />);
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    expect(api.clearBreak).toHaveBeenCalledWith("c9");
  });

  it("keeps quiet when the break can't be taken back", () => {
    api.clearBreak.mockClear();
    api.clearBreak.mockRejectedValueOnce(new Error("gone"));
    const view = render(<TagsCell card={makeCard({ id: "c9", broke: { kind: "build", at: NOW, why: "it broke the build" } })} />);
    expect(() => fireEvent.click(view.getByRole("button", { name: "Dismiss" }))).not.toThrow();
  });
});

describe("AgeCell", () => {
  it("says how long ago it was", () => {
    const view = render(<AgeCell at={NOW - 7_200_000} now={NOW} />);
    expect(view.getByText("2h")).toBeInTheDocument();
  });

  it("says just now for a moment ago", () => {
    const view = render(<AgeCell at={NOW - 5_000} now={NOW} />);
    expect(view.getByText("just now")).toBeInTheDocument();
  });
});

describe("ActionsCell", () => {
  it("offers to continue a card with a session", () => {
    const onResume = vi.fn();
    const view = render(<ActionsCell card={makeCard({ sessionId: "s1" })} onResume={onResume} />);
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    expect(onResume).toHaveBeenCalledWith("continue");
  });

  it("offers to stop a running thread", () => {
    const onStop = vi.fn();
    const view = render(<ActionsCell card={makeCard({ column: "running" })} onStop={onStop} />);
    fireEvent.click(view.getByRole("button", { name: "Stop this thread" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("has no stop button on a thread that isn't running", () => {
    const view = render(<ActionsCell card={makeCard({ column: "review" })} onStop={vi.fn()} />);
    expect(view.queryByRole("button", { name: "Stop this thread" })).toBeNull();
  });

  it("has no stop button when there's nothing to stop it with", () => {
    const view = render(<ActionsCell card={makeCard({ column: "running" })} />);
    expect(view.queryByRole("button", { name: "Stop this thread" })).toBeNull();
  });

  it("stars a card", () => {
    const onStar = vi.fn();
    const view = render(<ActionsCell card={makeCard()} onStar={onStar} />);
    fireEvent.click(view.getByRole("button", { name: "Star" }));
    expect(onStar).toHaveBeenCalled();
  });

  it("says a starred card is starred", () => {
    const view = render(<ActionsCell card={makeCard({ starred: true })} onStar={vi.fn()} />);
    expect(view.getByRole("button", { name: "Starred" })).toBeInTheDocument();
  });

  it("has no star when there's nothing to star it with", () => {
    const view = render(<ActionsCell card={makeCard()} />);
    expect(view.queryByRole("button", { name: "Star" })).toBeNull();
  });

  it("archives a done card", () => {
    const onArchive = vi.fn();
    const view = render(<ActionsCell card={makeCard({ column: "done" })} onArchive={onArchive} />);
    fireEvent.click(view.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalled();
  });

  it("archives a backlog card", () => {
    const view = render(<ActionsCell card={makeCard({ column: "backlog" })} onArchive={vi.fn()} />);
    expect(view.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("unarchives an archived card", () => {
    const view = render(<ActionsCell card={makeCard({ column: "review", archived: true })} onArchive={vi.fn()} />);
    expect(view.getByRole("button", { name: "Unarchive" })).toBeInTheDocument();
  });

  it("has no archive button on a card you can't archive", () => {
    const view = render(<ActionsCell card={makeCard({ column: "review" })} onArchive={vi.fn()} />);
    expect(view.queryByRole("button", { name: "Archive" })).toBeNull();
  });
});

export type { Card };

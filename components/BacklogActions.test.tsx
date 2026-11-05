// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";
import type { Sprint } from "@/lib/sprints";

// The Backlog header (ColumnHeader with a `backlog` lane): Save as sprint, Archive all behind an
// "Are you sure?", and the sprints list under its title. The sprints client is mocked.

const sprint: Sprint = { id: "s1", name: "Sprint 1 · Oct 18", cardIds: ["a", "b"], createdAt: 1 };
const sprints = vi.hoisted(() => ({ list: [] as Sprint[], save: vi.fn(), rename: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/use-sprints", () => ({
  useSprints: () => sprints.list,
  sprintActions: { save: sprints.save, rename: sprints.rename, remove: sprints.remove },
}));

const { default: ColumnHeader } = await import("./ColumnHeader");

const card = (over: Partial<Card>) => ({ id: "a", title: "A", column: "backlog", ...over }) as Card;

function setup(cards: Card[] = [card({ id: "a" }), card({ id: "b" })], allCards: Card[] = cards) {
  const lane = { cards, allCards, onArchiveAll: vi.fn(), onRestore: vi.fn(), toast: vi.fn(), notify: vi.fn() };
  render(
    <ColumnHeader
      column={{ id: "backlog", label: "Backlog" }}
      count={cards.length}
      needsYou={false}
      archivedCount={0}
      showArchived={false}
      onToggleArchived={() => {}}
      toArchive={0}
      archiveTip=""
      onArchiveAll={() => {}}
      backlog={lane}
    />,
  );
  return lane;
}

beforeEach(() => {
  sprints.list = [];
  sprints.save.mockReset().mockResolvedValue(sprint);
  sprints.rename.mockReset().mockResolvedValue(undefined);
  sprints.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("a column's fold chevron", () => {
  it("folds the column, even while it's empty, and only shows when the column can fold", async () => {
    const onFold = vi.fn();
    const header = (fold?: () => void) => (
      <ColumnHeader column={{ id: "done", label: "Done" }} count={0} needsYou={false} archivedCount={0} showArchived={false}
        onToggleArchived={() => {}} toArchive={0} archiveTip="" onArchiveAll={() => {}} onFold={fold} />
    );
    const { rerender } = render(header(onFold));
    await userEvent.click(screen.getByRole("button", { name: "Fold Done" }));
    expect(onFold).toHaveBeenCalledOnce();
    rerender(header());
    expect(screen.queryByRole("button", { name: "Fold Done" })).toBeNull();
  });
});

describe("Backlog header", () => {
  it("saves the lane's cards as a sprint and says so", async () => {
    const lane = setup();
    await userEvent.click(screen.getByRole("button", { name: /as a sprint/ }));
    expect(sprints.save).toHaveBeenCalledWith(["a", "b"]);
    await waitFor(() => expect(lane.toast).toHaveBeenCalledWith("Saved 2 cards as “Sprint 1 · Oct 18”"));
  });

  it("reports a failed save", async () => {
    sprints.save.mockRejectedValueOnce(new Error("disk full"));
    const lane = setup();
    await userEvent.click(screen.getByRole("button", { name: /as a sprint/ }));
    await waitFor(() => expect(lane.notify).toHaveBeenCalled());
  });

  it("asks before archiving the lane, and Cancel archives nothing", async () => {
    const lane = setup();
    await userEvent.click(screen.getByRole("button", { name: "Archive all 2 in Backlog" }));
    expect(screen.getByRole("dialog", { name: "Archive all 2 in Backlog?" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(lane.onArchiveAll).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("archives on Archive all", async () => {
    const lane = setup();
    await userEvent.click(screen.getByRole("button", { name: "Archive all 2 in Backlog" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive all" }));
    expect(lane.onArchiveAll).toHaveBeenCalledOnce();
  });

  it("can save the lane as a sprint first, then archive", async () => {
    const lane = setup();
    await userEvent.click(screen.getByRole("button", { name: "Archive all 2 in Backlog" }));
    await userEvent.click(screen.getByRole("button", { name: "Save as sprint, then archive" }));
    await waitFor(() => expect(lane.onArchiveAll).toHaveBeenCalledOnce());
    expect(sprints.save).toHaveBeenCalledWith(["a", "b"]);
  });

  it("shows no actions on an empty lane", () => {
    setup([]);
    expect(screen.queryByRole("button", { name: /Archive all/ })).toBeNull();
  });
});

describe("Sprints list under the Backlog title", () => {
  it("says how to make one when there are none", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(screen.getByRole("menu", { name: "Sprints" }).textContent).toMatch(/None yet/);
  });

  it("lists each sprint with what became of its cards, and restores the archived ones", async () => {
    sprints.list = [sprint];
    const all = [card({ id: "a", archived: true }), card({ id: "b", column: "running" })];
    const lane = setup([], all);
    await userEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(screen.getByText("Sprint 1 · Oct 18")).toBeTruthy();
    expect(screen.getByText("2 cards · 1 archived · 1 started")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore 1" }));
    expect(lane.onRestore).toHaveBeenCalledWith(["a"]);
  });

  it("renames on double-click and deletes the sprint", async () => {
    sprints.list = [sprint];
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Backlog" }));
    await userEvent.dblClick(screen.getByText("Sprint 1 · Oct 18"));
    const input = screen.getByRole("textbox", { name: "Sprint name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Launch{Enter}");
    expect(sprints.rename).toHaveBeenCalledWith("s1", "Launch");
    await userEvent.click(screen.getByRole("button", { name: "Delete Sprint 1 · Oct 18" }));
    expect(sprints.remove).toHaveBeenCalledWith("s1");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ColumnHeader from "./ColumnHeader";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof ColumnHeader>[0]> = {}) {
  const onArchiveAll = vi.fn();
  const onToggleArchived = vi.fn();
  render(
    <ColumnHeader
      column={{ id: "done", label: "Done" }}
      count={3}
      needsYou={false}
      archivedCount={5}
      showArchived={false}
      onToggleArchived={onToggleArchived}
      toArchive={3}
      archiveTip="Archive all 3 (⇧E)"
      onArchiveAll={onArchiveAll}
      {...over}
    />,
  );
  return { onArchiveAll, onToggleArchived };
}

describe("ColumnHeader", () => {
  it("archives every Done card it shows in one click", async () => {
    const { onArchiveAll } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Archive all 3 in Done" }));
    expect(onArchiveAll).toHaveBeenCalledOnce();
  });

  it("toggles the archived cards", async () => {
    const { onToggleArchived } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Show 5 archived" }));
    expect(onToggleArchived).toHaveBeenCalledOnce();
  });

  it("hides both buttons when there is nothing to show or archive, keeping only Recently deleted", () => {
    setup({ archivedCount: 0, toArchive: 0 });
    expect(screen.queryAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Recently deleted"]);
  });

  it("puts no Done buttons on other columns", () => {
    setup({ column: { id: "review", label: "Review" } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("starts the review walk-through from Review, and holds the button while it starts", async () => {
    let finish = () => {};
    const onReviewAll = vi.fn(() => new Promise<void>((r) => (finish = r)));
    setup({ column: { id: "review", label: "Review" }, onReviewAll });
    await userEvent.click(screen.getByRole("button", { name: "Review all" }));
    expect(onReviewAll).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Starting…" })).toHaveProperty("disabled", true);
    finish();
    expect(await screen.findByRole("button", { name: "Review all" })).toBeTruthy();
  });

  it("shows no Review all on an empty column", () => {
    setup({ column: { id: "review", label: "Review" }, count: 0, onReviewAll: vi.fn() });
    expect(screen.queryByRole("button", { name: "Review all" })).toBeNull();
  });
});

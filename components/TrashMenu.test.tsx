// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrashItem } from "@/lib/trash-client";

const list = vi.hoisted(() => vi.fn<() => Promise<TrashItem[]>>());
const restore = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
vi.mock("@/lib/trash-client", () => ({ trashApi: { list, restore } }));

const { default: TrashMenu } = await import("./TrashMenu");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item = (id: string, title: string): TrashItem => ({ id, title, cwd: "/Users/me/dev/weft", deletedAt: Date.now() - 2 * 3600_000 });

describe("TrashMenu", () => {
  it("loads the list when it opens and restores a card from it", async () => {
    list.mockResolvedValueOnce([item("a", "Fix login"), item("b", "Add trash")]);
    restore.mockResolvedValueOnce({ id: "a" });
    render(<TrashMenu />);
    expect(list).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Recently deleted" }));
    expect(await screen.findByText("Fix login")).toBeTruthy();
    expect(screen.getAllByText("weft · deleted 2h ago")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Restore Fix login" }));
    expect(restore).toHaveBeenCalledWith("a");
    await vi.waitFor(() => expect(screen.queryByText("Fix login")).toBeNull());
    expect(screen.getByText("Add trash")).toBeTruthy();
  });

  it("says when there's nothing, and closes on a second click", async () => {
    list.mockResolvedValueOnce([]);
    render(<TrashMenu />);
    const button = screen.getByRole("button", { name: "Recently deleted" });
    await userEvent.click(button);
    expect(await screen.findByText("Nothing deleted in the last 30 days.")).toBeTruthy();
    await userEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows Loading… until the list comes, and the error when it fails", async () => {
    let fail: (err: unknown) => void = () => {};
    list.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    render(<TrashMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Recently deleted" }));
    expect(screen.getByText("Loading…")).toBeTruthy();
    fail("offline");
    expect(await screen.findByText("offline")).toBeTruthy();
  });

  it("shows a failed restore's reason and closes on Escape", async () => {
    list.mockResolvedValueOnce([item("a", "Fix login")]);
    restore.mockRejectedValueOnce(new Error("That card is already on the board."));
    render(<TrashMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Recently deleted" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore Fix login" }));
    expect(await screen.findByText("That card is already on the board.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

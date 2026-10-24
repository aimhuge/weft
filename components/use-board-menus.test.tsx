// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardMenus, type BoardMenuDeps } from "./use-board-menus";
import "./test-utils";
import { makeCard } from "./test-utils";

const api = vi.hoisted(() => ({
  devStatus: vi.fn(() => Promise.resolve({ status: null })),
  mark: vi.fn(() => Promise.resolve({})),
  send: vi.fn(() => Promise.resolve({})),
  stop: vi.fn(() => Promise.resolve({})),
  switchBackend: vi.fn(() => Promise.resolve({})),
  setMode: vi.fn(() => Promise.resolve({})),
  devAction: vi.fn(() => Promise.resolve({ status: { state: "stopped" } })),
}));
vi.mock("@/lib/client", () => ({ api }));

type Menus = ReturnType<typeof useBoardMenus>;

// Renders the hook and hands back its result, so a test can drive the card menu.
function setup(pick: string | null = "delete", over: Partial<BoardMenuDeps> = {}) {
  const popupMenu = vi.fn(() => Promise.resolve(pick));
  (window as unknown as { weft: unknown }).weft = { popupMenu };
  const deps = {
    doneShown: [],
    archivedCount: 0,
    showArchived: false,
    openCard: vi.fn(),
    renameCard: vi.fn(),
    move: vi.fn(),
    toggleArchive: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
    openNew: vi.fn(),
    toggleArchived: vi.fn(),
    toast: vi.fn(),
    notify: vi.fn(),
    ...over,
  } satisfies BoardMenuDeps;
  let menus: Menus | null = null;
  function Probe() {
    menus = useBoardMenus(deps);
    return <div>{menus.deleteDialog}</div>;
  }
  render(<Probe />);
  return { deps, popupMenu, menus: menus! };
}

// Right-click the card and pick the action from the native menu.
async function openMenu(menus: Menus, card = makeCard()) {
  await act(async () => {
    await menus.onCardMenu(card, { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent);
  });
}

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("useBoardMenus and the delete confirmation", () => {
  it("shows no dialog until a delete is asked for", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before deleting, and deletes only once confirmed", async () => {
    const { deps, menus } = setup();
    await openMenu(menus);
    expect(screen.getByRole("dialog", { name: "Delete card" })).toBeInTheDocument();
    expect(deps.remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deps.remove).not.toHaveBeenCalled();

    await openMenu(menus);
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deps.remove).toHaveBeenCalledOnce();
  });

  it("deletes straight away when the user said not to be asked", async () => {
    localStorage.setItem("weft.delete.skipConfirm", "1");
    const { deps, menus } = setup();
    await openMenu(menus);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.remove).toHaveBeenCalledOnce();
  });

  it("leaves the card alone when the menu is dismissed", async () => {
    const { deps, menus } = setup(null);
    await openMenu(menus);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("says a running card's turn is stopped, the way the thread panel does", async () => {
    const { menus } = setup();
    await openMenu(menus, makeCard({ column: "running" }));
    expect(screen.getByText(/This stops its turn\./)).toBeInTheDocument();
  });

  it("leaves that line out for a card that isn't running", async () => {
    const { menus } = setup();
    await openMenu(menus, makeCard({ column: "backlog" }));
    expect(screen.queryByText(/This stops its turn\./)).toBeNull();
  });
});

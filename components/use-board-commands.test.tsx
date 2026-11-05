// @vitest-environment jsdom
// useBoardCommands' wiring: what the shortcuts, the palette and the menu bridge each get from the
// board. Their own behavior is tested beside them (board-shortcuts via hotkeys, board-palette.test.tsx,
// lib/board-menu-bridge.test.ts); here they're stubbed to record what they were handed.

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const m = vi.hoisted(() => ({
  useShortcuts: vi.fn(),
  useShortcutListener: vi.fn(),
  useMenuBridge: vi.fn(),
  useOnboardingEvents: vi.fn(),
  boardShortcuts: vi.fn((ctx: unknown) => ctx),
  boardPaletteItems: vi.fn<(state: unknown, actions: unknown) => { id: string }[]>(() => [{ id: "x" }]),
  promptItems: vi.fn(() => [{ id: "p" }]),
  moveFocus: vi.fn(),
  openFocused: vi.fn(),
  jumpToNeedsYou: vi.fn(),
  focusFilter: vi.fn(),
  filterHasFocus: vi.fn(),
  addSecret: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  searchPrompts: vi.fn(() => Promise.resolve({ hits: ["h"] })),
}));
vi.mock("@/lib/hotkeys", () => ({ useShortcuts: m.useShortcuts, useShortcutListener: m.useShortcutListener }));
vi.mock("@/lib/board-menu-bridge", () => ({ useMenuBridge: m.useMenuBridge }));
vi.mock("@/lib/onboarding-events", () => ({ useOnboardingEvents: m.useOnboardingEvents }));
vi.mock("./board-shortcuts", () => ({ boardShortcuts: m.boardShortcuts }));
vi.mock("./board-palette", () => ({ boardPaletteItems: m.boardPaletteItems, promptItems: m.promptItems }));
vi.mock("@/lib/board-focus", () => ({ moveFocus: m.moveFocus, openFocused: m.openFocused, jumpToNeedsYou: m.jumpToNeedsYou, focusFilter: m.focusFilter, filterHasFocus: m.filterHasFocus }));
vi.mock("@/lib/use-vault", () => ({ addSecret: m.addSecret }));
vi.mock("@/lib/client", () => ({ api: { stop: m.stop, searchPrompts: m.searchPrompts } }));

import { useBoardCommands, type BoardCommandsInput } from "./use-board-commands";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Fn = (...a: unknown[]) => unknown;
type Fns = Record<string, unknown>;
// Calls the function recorded as `name` on a stub's props.
const call = (o: Fns, name: string, ...args: unknown[]) => (o[name] as Fn)(...args);
// The actions object the palette was built with, on its nth build.
const paletteActions = (n = 0) => (m.boardPaletteItems.mock.calls[n]?.[1] ?? {}) as Fns;
const card = { id: "a", column: "review" } as Card;

function input(over: Partial<BoardCommandsInput> = {}): BoardCommandsInput {
  return {
    cards: [card],
    selected: card,
    selectedId: "a",
    lastOpenId: "a",
    projectSummaries: [{ path: "/p1" }, { path: "/p2" }] as BoardCommandsInput["projectSummaries"],
    project: "/p1",
    sort: "recent" as BoardCommandsInput["sort"],
    home: "/h",
    columns: [{ id: "review" }],
    query: "q",
    boardKeys: true,
    dialogs: { showNew: false, showSettings: false, showHelp: false, showPalette: false, login: null },
    doneToArchive: [],
    lastArchived: [],
    archivedCount: 2,
    showArchived: false,
    rootOf: (cwd) => cwd,
    restart: { armed: true },
    openNew: vi.fn(),
    openCard: vi.fn(),
    select: vi.fn(),
    toggleCopilot: vi.fn(),
    toggleBrowser: vi.fn(),
    toggleTerminal: vi.fn(),
    toggleColumn: vi.fn(),
    setShowPalette: vi.fn(),
    setPaletteQuery: vi.fn(),
    setShowHelp: vi.fn(),
    setShowSettings: vi.fn(),
    setSharingBoard: vi.fn(),
    setLibraryOpen: vi.fn(),
    setShowArchived: vi.fn(),
    archiveTarget: vi.fn(),
    archiveCards: vi.fn(),
    unarchive: vi.fn(),
    toggleArchive: vi.fn(),
    chooseSort: vi.fn(),
    chooseProject: vi.fn(),
    move: vi.fn(),
    notify: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

function run(over: Partial<BoardCommandsInput> = {}) {
  const c = input(over);
  const { result } = renderHook(() => useBoardCommands(c));
  const shortcuts = m.boardShortcuts.mock.calls[0]?.[0] as Fns;
  return { c, result: result.current, shortcuts };
}

describe("shortcuts", () => {
  it("get the dialogs, the open card and the board's state, and listen", () => {
    const { c, shortcuts } = run({ selected: null });
    expect(shortcuts).toMatchObject({ ...c.dialogs, query: "q", boardKeys: true, cardOpen: true, toggleColumn: c.toggleColumn, archiveTarget: c.archiveTarget });
    expect(m.useShortcuts).toHaveBeenCalledWith(shortcuts);
    expect(m.useShortcutListener).toHaveBeenCalled();
  });

  it("bind arrow focus to the visible columns and the open card's id, even before it loads", () => {
    const { c, shortcuts } = run({ selected: null });
    call(shortcuts, "moveFocus", { dx: 1 });
    expect(m.moveFocus).toHaveBeenCalledWith({ dx: 1 }, c.columns, "a", null);
    const e = new KeyboardEvent("keydown");
    call(shortcuts, "openFocused", e);
    expect(m.openFocused).toHaveBeenCalledWith(e, c.cards, c.openCard);
  });

  it("step through projects (All first) and sorts", () => {
    const { c, shortcuts } = run();
    call(shortcuts, "stepProject", 1);
    expect(c.chooseProject).toHaveBeenCalledWith("/p2");
    call(shortcuts, "stepProject", -1);
    expect(c.chooseProject).toHaveBeenLastCalledWith(null);
    call(shortcuts, "stepSort");
    expect(c.chooseSort).toHaveBeenCalledTimes(1);
  });

  it("reopen the card you had open last, once it's closed", () => {
    const { c, shortcuts } = run({ selected: null, selectedId: null });
    expect(call(shortcuts, "reopenLast")).toBeUndefined();
    expect(c.openCard).toHaveBeenCalledWith(card);
  });

  it("pass Z on while a card is open, or when the last one is gone", () => {
    const open = run();
    expect(call(open.shortcuts, "reopenLast")).toBe(false);
    cleanup();
    vi.clearAllMocks();
    const gone = run({ selected: null, selectedId: null, lastOpenId: "deleted" });
    expect(call(gone.shortcuts, "reopenLast")).toBe(false);
    expect(gone.c.openCard).not.toHaveBeenCalled();
    expect(open.c.openCard).not.toHaveBeenCalled();
  });

  it("open the palette with the trimmed query", () => {
    const { c, result } = run();
    result.openPalette("  find me ");
    expect(c.setPaletteQuery).toHaveBeenCalledWith("find me");
    expect(c.setShowPalette).toHaveBeenCalledWith(true);
  });
});

describe("menu bridge and onboarding", () => {
  it("get the board's actions", () => {
    const { c } = run();
    const bridge = (m.useMenuBridge.mock.calls[0]?.[0] ?? {}) as Fns;
    expect(bridge).toMatchObject({ cards: c.cards, openNew: c.openNew, openCard: c.openCard, select: c.select, toggleTerminal: c.toggleTerminal, openDrawer: c.setLibraryOpen, focusFilter: m.focusFilter });
    call(bridge, "openSettings");
    expect(c.setShowSettings).toHaveBeenCalledWith(true);
    expect(m.useOnboardingEvents).toHaveBeenCalledWith(c.openNew, c.select);
  });
});

describe("palette", () => {
  it("builds nothing while closed", () => {
    expect(run().result.paletteItems()).toEqual([]);
    expect(m.boardPaletteItems).not.toHaveBeenCalled();
  });

  it("builds the items from the board's state while open, restart armed or not", () => {
    const dialogs = { showNew: false, showSettings: false, showHelp: false, showPalette: true, login: null };
    expect(run({ dialogs }).result.paletteItems()).toEqual([{ id: "x" }]);
    expect(m.boardPaletteItems.mock.calls[0]?.[0]).toMatchObject({ archivedCount: 2, restartArmed: true, home: "/h" });
    run({ dialogs, restart: null }).result.paletteItems();
    expect(m.boardPaletteItems.mock.calls[1]?.[0]).toMatchObject({ restartArmed: false });
  });

  it("wires each palette action through to the board", () => {
    const dialogs = { showNew: false, showSettings: false, showHelp: false, showPalette: true, login: null };
    const { c, result } = run({ dialogs });
    result.paletteItems();
    const a = paletteActions();
    expect(a).toMatchObject({ openNew: c.openNew, focusFilter: m.focusFilter, archiveCards: c.archiveCards, move: c.move, chooseProject: c.chooseProject, openCard: c.openCard, toast: c.toast });
    call(a, "openSettings");
    expect(c.setShowSettings).toHaveBeenCalledWith(true);
    call(a, "shareBoard");
    expect(c.setSharingBoard).toHaveBeenCalledWith(true);
    call(a, "openHelp");
    expect(c.setShowHelp).toHaveBeenCalledWith(true);
    call(a, "addSecret");
    expect(m.addSecret).toHaveBeenCalledWith(c.setLibraryOpen);
    call(a, "jumpToNeedsYou");
    expect(m.jumpToNeedsYou).toHaveBeenCalled();
    call(a, "toggleShowArchived");
    const flip = vi.mocked(c.setShowArchived).mock.calls[0]?.[0] as (v: boolean) => boolean;
    expect(flip(false)).toBe(true);
    call(a, "closeThread");
    expect(c.select).toHaveBeenCalledWith(null);
    call(a, "stop", "a");
    expect(m.stop).toHaveBeenCalledWith("a");
  });

  it("focuses the open thread's reply box", () => {
    const dialogs = { showNew: false, showSettings: false, showHelp: false, showPalette: true, login: null };
    document.body.innerHTML = '<aside><textarea id="reply"></textarea></aside>';
    run({ dialogs }).result.paletteItems();
    call(paletteActions(), "focusReply");
    expect(document.activeElement?.id).toBe("reply");
    document.body.innerHTML = "";
    call(paletteActions(), "focusReply");
  });

  it("finds the user's prompts as items that open their card", async () => {
    const { c, result } = run();
    await expect(result.findPrompts("login")).resolves.toEqual([{ id: "p" }]);
    expect(m.searchPrompts).toHaveBeenCalledWith("login");
    expect(m.promptItems).toHaveBeenCalledWith(["h"], c.cards, c.rootOf, c.openCard);
  });
});

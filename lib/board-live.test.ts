// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, Card, ThreadItem } from "./types";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  settings: vi.fn(),
  effects: vi.fn(),
  announce: vi.fn(),
  playChime: vi.fn(),
  announceAccountChange: vi.fn(),
  useBoardEvents: vi.fn(),
  remove: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("./client", () => ({ api: { list: mocks.list, settings: mocks.settings, remove: mocks.remove, stop: mocks.stop } }));
vi.mock("./board-view", () => ({ cardChangeEffects: mocks.effects }));
vi.mock("./board-helpers", async (orig) => ({ ...(await orig<typeof import("./board-helpers")>()), announce: mocks.announce }));
vi.mock("./chimes", () => ({ playChime: mocks.playChime }));
vi.mock("./use-account", () => ({ announceAccountChange: mocks.announceAccountChange }));
vi.mock("./use-events", () => ({ useBoardEvents: mocks.useBoardEvents }));

import { LIST_RETRY_MS, onBoardEvent, reloadBoard, useBoardLive, type BoardLive } from "./board-live";
import { removeNow, stopNow } from "./optimistic-cards";

const card = (over: Partial<Card> = {}): Card => ({ id: "a", title: "A", column: "running", cwd: "/r", ...over }) as Card;

// A setter that applies its update to a held value, like React's.
function state<T>(initial: T) {
  const box = { value: initial };
  const set = vi.fn((next: T | ((prev: T) => T)) => {
    box.value = typeof next === "function" ? (next as (prev: T) => T)(box.value) : next;
  });
  return { box, set };
}

function live(over: Partial<BoardLive> = {}) {
  const cards = state<Card[]>([card({ id: "a" }), card({ id: "b" })]);
  const unseen = state<ReadonlySet<string>>(new Set(["b"]));
  const thread = state<ThreadItem[]>([{ kind: "user", text: "0" } as ThreadItem, { kind: "user", text: "1" } as ThreadItem]);
  const streaming = state("abc");
  const l: BoardLive = {
    columns: { current: new Map() },
    errors: { current: new Map() },
    ownMoves: { current: new Map([["a", { column: "review", at: 1 }]]) },
    selectedRef: { current: "a" },
    resolvedFolders: { current: new Set() },
    select: vi.fn(),
    setSelectedId: vi.fn(),
    setCards: cards.set,
    setUnseen: unseen.set,
    setThread: thread.set,
    setStreaming: streaming.set,
    setProjects: vi.fn(),
    setLogin: vi.fn(),
    setToast: vi.fn(),
    setHome: vi.fn(),
    setRoots: vi.fn(),
    setLoaded: vi.fn(),
    updateCopilot: vi.fn(),
    loadCopilot: vi.fn(),
    resolveFolders: vi.fn(),
    restart: { apply: vi.fn(), reload: vi.fn() },
    loadFromPrefs: vi.fn(),
    loadThread: vi.fn(),
    notify: vi.fn(),
    ...over,
  };
  return { l, cards: cards.box, unseen: unseen.box, thread: thread.box, streaming: streaming.box };
}

const NONE = { moved: false, chime: undefined, markUnseen: false, errorChime: false };

beforeEach(() => vi.clearAllMocks());

describe("onBoardEvent: card", () => {
  it("hands the copilot to its own lane", () => {
    const { l } = live();
    const copilot = card({ id: "cp", role: "copilot" });
    onBoardEvent({ type: "card", card: copilot }, l);
    expect(l.updateCopilot).toHaveBeenCalledWith(copilot);
    expect(l.setCards).not.toHaveBeenCalled();
  });

  it("replaces a known card in place and records its column and error", () => {
    mocks.effects.mockReturnValue(NONE);
    const { l, cards } = live();
    const next = card({ id: "b", title: "B2", column: "review", error: "boom" });
    onBoardEvent({ type: "card", card: next }, l);
    expect(cards.value.map((c) => c.title)).toEqual(["A", "B2"]);
    expect(l.columns.current.get("b")).toBe("review");
    expect(l.errors.current.get("b")).toBe("boom");
    expect(l.resolveFolders).toHaveBeenCalledWith(["/r"]);
    expect(mocks.effects).toHaveBeenCalledWith(expect.objectContaining({ column: "review", error: "boom", open: false }));
    expect(mocks.playChime).not.toHaveBeenCalled();
  });

  it("puts a new card first, announces a move, chimes, and marks it unseen", () => {
    mocks.effects.mockReturnValue({ moved: true, chime: "review", markUnseen: true, errorChime: true });
    const { l, cards, unseen } = live();
    onBoardEvent({ type: "card", card: card({ id: "a" }) }, l);
    onBoardEvent({ type: "card", card: card({ id: "new" }) }, l);
    expect(cards.value[0]?.id).toBe("new");
    expect(l.ownMoves.current.has("a")).toBe(false);
    (mocks.announce.mock.calls[0]?.[1] as () => void)();
    expect(l.select).toHaveBeenCalledWith("a");
    expect(mocks.playChime.mock.calls).toEqual([["review"], ["error"], ["review"], ["error"]]);
    expect([...unseen.value].sort()).toEqual(["a", "b", "new"]);
    // Already unseen: the set is left as it was.
    const before = unseen.value;
    onBoardEvent({ type: "card", card: card({ id: "new" }) }, l);
    expect(unseen.value).toBe(before);
  });
});

describe("onBoardEvent: the rest", () => {
  it("drops a deleted card, its unseen mark, and closes it if open", () => {
    const { l, cards, unseen } = live();
    onBoardEvent({ type: "card_deleted", id: "b" }, l);
    expect(cards.value.map((c) => c.id)).toEqual(["a"]);
    expect(unseen.value.has("b")).toBe(false);
    expect(l.setSelectedId).not.toHaveBeenCalled();
    const kept = unseen.value;
    onBoardEvent({ type: "card_deleted", id: "a" }, l);
    expect(unseen.value).toBe(kept);
    expect(l.setSelectedId).toHaveBeenCalledWith(null);
  });

  it("writes thread items for the open card only, truncating when asked", () => {
    const { l, thread, streaming } = live();
    const item = { kind: "assistant", text: "x" } as ThreadItem;
    onBoardEvent({ type: "thread", cardId: "other", index: 0, item }, l);
    expect(l.setThread).not.toHaveBeenCalled();
    onBoardEvent({ type: "thread", cardId: "a", index: 2, item }, l);
    expect(thread.value).toHaveLength(3);
    expect(streaming.value).toBe("");
    streaming.value = "s";
    onBoardEvent({ type: "thread", cardId: "a", index: 0, item: { kind: "user" } as ThreadItem, truncate: true }, l);
    expect(thread.value).toEqual([{ kind: "user" }]);
    expect(streaming.value).toBe("s");
    onBoardEvent({ type: "thread", cardId: "a", index: 1, item: { kind: "result" } as ThreadItem }, l);
    expect(streaming.value).toBe("");
  });

  it("appends deltas for the open card only", () => {
    const { l, streaming } = live();
    onBoardEvent({ type: "delta", cardId: "a", text: "d" }, l);
    onBoardEvent({ type: "delta", cardId: "z", text: "!" }, l);
    expect(streaming.value).toBe("abcd");
  });

  it("handles account, restart, projects and login", () => {
    const { l } = live();
    onBoardEvent({ type: "account" }, l);
    expect(mocks.announceAccountChange).toHaveBeenCalled();
    onBoardEvent({ type: "restart", restart: { armed: true } } as BoardEvent, l);
    expect(l.setToast).not.toHaveBeenCalled();
    onBoardEvent({ type: "restart", restart: { armed: false, error: "nope" } } as BoardEvent, l);
    expect(l.restart.apply).toHaveBeenCalledTimes(2);
    expect(l.setToast).toHaveBeenCalledWith("nope");
    onBoardEvent({ type: "projects", projects: [{ path: "/p" }] } as BoardEvent, l);
    expect(l.resolveFolders).toHaveBeenCalledWith(["/p"]);
    expect(l.setProjects).toHaveBeenCalledWith([{ path: "/p" }]);
    const login = { state: "waiting" };
    onBoardEvent({ type: "login", login } as BoardEvent, l);
    onBoardEvent({ type: "login", login: { state: "cancelled" } } as BoardEvent, l);
    expect(vi.mocked(l.setLogin).mock.calls).toEqual([[login], [null]]);
    onBoardEvent({ type: "unknown" } as unknown as BoardEvent, l);
  });
});

describe("reloadBoard", () => {
  it("reloads cards, projects, prefs, the copilot, the restart chip and the open thread", async () => {
    const cards = [card({ id: "a", column: "done", error: "e" })];
    mocks.list.mockResolvedValue({ cards, home: "/h", roots: { "/w": "/r" } });
    mocks.settings.mockResolvedValue({ projects: [{ path: "/p" }] });
    const { l } = live();
    reloadBoard(l);
    await vi.waitFor(() => expect(l.setLoaded).toHaveBeenCalledWith(true));
    await vi.waitFor(() => expect(l.setProjects).toHaveBeenCalledWith([{ path: "/p" }]));
    expect(l.columns.current.get("a")).toBe("done");
    expect(l.errors.current.get("a")).toBe("e");
    expect([...l.resolvedFolders.current]).toEqual(["/r", "/p"]);
    expect(l.setCards).toHaveBeenCalledWith(cards);
    expect(l.setHome).toHaveBeenCalledWith("/h");
    expect(l.setRoots).toHaveBeenCalledWith({ "/w": "/r" });
    expect(l.loadFromPrefs).toHaveBeenCalled();
    expect(l.loadCopilot).toHaveBeenCalled();
    expect(l.restart.reload).toHaveBeenCalled();
    expect(l.loadThread).toHaveBeenCalledWith("a");
  });

  it("reports a failed card list and ignores a failed settings read; no open card, no thread load", async () => {
    const err = new Error("down");
    mocks.list.mockRejectedValue(err);
    mocks.settings.mockRejectedValue(new Error("x"));
    const { l } = live({ selectedRef: { current: null } });
    reloadBoard(l);
    await vi.waitFor(() => expect(l.notify).toHaveBeenCalledWith(err));
    expect(l.setProjects).not.toHaveBeenCalled();
    expect(l.loadThread).not.toHaveBeenCalled();
  });

  it("tries a failed card list again until it lands, reporting only the first failure", async () => {
    vi.useFakeTimers();
    try {
      mocks.list
        .mockRejectedValueOnce(new Error("broken build"))
        .mockRejectedValueOnce(new Error("still"))
        .mockResolvedValue({ cards: [card()], home: "/h", roots: {} });
      mocks.settings.mockResolvedValue({ projects: [] });
      const { l } = live();
      reloadBoard(l);
      await vi.advanceTimersByTimeAsync(LIST_RETRY_MS[0] ?? 0);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(LIST_RETRY_MS[1] ?? 0);
      expect(mocks.list).toHaveBeenCalledTimes(3);
      expect(l.setLoaded).toHaveBeenCalledWith(true);
      expect(l.notify).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting the longest gap once the retries run out", async () => {
    vi.useFakeTimers();
    try {
      mocks.list.mockRejectedValue(new Error("down"));
      mocks.settings.mockResolvedValue({ projects: [] });
      const { l } = live();
      reloadBoard(l);
      const total = LIST_RETRY_MS.reduce((a, b) => a + b, 0);
      await vi.advanceTimersByTimeAsync(total + LIST_RETRY_MS.at(-1)!);
      expect(mocks.list).toHaveBeenCalledTimes(LIST_RETRY_MS.length + 2);
      mocks.list.mockReturnValue(new Promise(() => {})); // the newer reload's list never answers
      reloadBoard(live().l); // a newer reload: the old run's next retry stops
      const calls = mocks.list.mock.calls.length;
      await vi.advanceTimersByTimeAsync(LIST_RETRY_MS.at(-1)!);
      expect(mocks.list.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a newer reload drops an older one's late answer, failed or not", async () => {
    let failOld!: (err: Error) => void;
    let answerOld!: (data: unknown) => void;
    mocks.list
      .mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)))
      .mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)))
      .mockReturnValue(new Promise(() => {}));
    mocks.settings.mockResolvedValue({ projects: [] });
    const first = live().l;
    const second = live().l;
    reloadBoard(first);
    reloadBoard(second);
    reloadBoard(live().l);
    failOld(new Error("late"));
    answerOld({ cards: [card()], home: "/h", roots: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(first.notify).not.toHaveBeenCalled();
    expect(second.setLoaded).not.toHaveBeenCalled();
  });
});

describe("useBoardLive", () => {
  it("subscribes with handlers bound to the board's state", () => {
    mocks.list.mockResolvedValue({ cards: [], home: "", roots: {} });
    mocks.settings.mockResolvedValue({ projects: [] });
    const { l } = live();
    renderHook(() => useBoardLive(l));
    const [onEvent, onOpen] = mocks.useBoardEvents.mock.calls[0] as [(e: BoardEvent) => void, () => void];
    onEvent({ type: "account" });
    expect(mocks.announceAccountChange).toHaveBeenCalled();
    onOpen();
    expect(l.loadFromPrefs).toHaveBeenCalled();
  });

  it("draws a delete and a stop at once, and reloads when the server refuses one", async () => {
    mocks.list.mockResolvedValue({ cards: [card({ id: "a" }), card({ id: "b" })], home: "", roots: {} });
    mocks.settings.mockResolvedValue({ projects: [] });
    mocks.remove.mockReturnValue(new Promise(() => {}));
    mocks.stop.mockRejectedValueOnce(new Error("gone"));
    const { l, cards } = live();
    const { unmount } = renderHook(() => useBoardLive(l));
    act(() => void removeNow("a").catch(() => {}));
    expect(cards.value.map((c) => c.id)).toEqual(["b"]);
    // A late update for the deleted card doesn't bring it back.
    onBoardEvent({ type: "card", card: card({ id: "a", column: "review" }) }, l);
    expect(cards.value.map((c) => c.id)).toEqual(["b"]);
    await act(() => stopNow("b").catch(() => {}));
    expect(mocks.list).toHaveBeenCalled();
    onBoardEvent({ type: "card_deleted", id: "a" }, l);
    unmount();
  });
});

describe("optimistic stop in the live updates", () => {
  it("keeps a stopping card out of Running until its turn ends", async () => {
    mocks.stop.mockResolvedValue({ ok: true });
    const { l, cards } = live();
    await stopNow("a");
    onBoardEvent({ type: "card", card: card({ id: "a", column: "running" }) }, l);
    expect(cards.value.find((c) => c.id === "a")).toMatchObject({ column: "review", lastLine: "Stopped" });
    onBoardEvent({ type: "card", card: card({ id: "a", column: "review", lastLine: "Stopped by you" }) }, l);
    expect(cards.value.find((c) => c.id === "a")?.lastLine).toBe("Stopped by you");
  });
});

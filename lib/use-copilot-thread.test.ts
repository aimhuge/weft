// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, Card, ThreadItem } from "./types";

const copilot = vi.fn<() => Promise<{ card: Card }>>();
const thread = vi.fn<(id: string) => Promise<{ items: ThreadItem[] }>>();
const send = vi.fn<(id: string, text: string) => Promise<void>>();
const resetCopilot = vi.fn<() => Promise<{ card: Card }>>();
const copilotPersona = vi.fn<(persona: string) => Promise<{ card: Card }>>();
const remove = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("./client", () => ({
  api: {
    copilot: () => copilot(),
    thread: (id: string) => thread(id),
    send: (id: string, text: string) => send(id, text),
    resetCopilot: () => resetCopilot(),
    copilotPersona: (persona: string) => copilotPersona(persona),
    remove: (id: string) => remove(id),
  },
  // The real merge keeps live items past the snapshot; enough here to tell merge from replace.
  mergeThread: (items: ThreadItem[], live: ThreadItem[]) => [...items, ...live.slice(items.length)],
}));

// Captures the hook's event handlers so a test can play the live stream.
const stream = vi.hoisted(() => {
  const handlers: { onEvent: (event: BoardEvent) => void; onOpen: () => void } = { onEvent: () => {}, onOpen: () => {} };
  return handlers;
});
vi.mock("./use-events", () => ({
  useBoardEvents: (onEvent: (e: BoardEvent) => void, onOpen: () => void) => {
    stream.onEvent = onEvent;
    stream.onOpen = onOpen;
  },
}));

const { useCopilotThread } = await import("./use-copilot-thread");
const { forget, patchNow, removeNow } = await import("./optimistic-cards");

const pilot = (over: Partial<Card> = {}) => ({ id: "copilot", role: "copilot", title: "Copilot", column: "review", ...over }) as Card;
const say = (text: string, at = 1): ThreadItem => ({ kind: "assistant", text, at });

beforeEach(() => {
  copilot.mockReset().mockResolvedValue({ card: pilot() });
  thread.mockReset().mockResolvedValue({ items: [say("hello")] });
  send.mockReset().mockResolvedValue();
  resetCopilot.mockReset().mockResolvedValue({ card: pilot({ column: "backlog" }) });
  copilotPersona.mockReset();
  remove.mockReset().mockResolvedValue(undefined);
  forget("copilot");
});

afterEach(cleanup);

describe("useCopilotThread", () => {
  it("loads the copilot's card and thread when the stream opens", async () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.items).toEqual([say("hello")]));
    expect(result.current.card?.id).toBe("copilot");
    expect(thread).toHaveBeenCalledWith("copilot");
  });

  it("replaces what it shows on a reconnect", async () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => stream.onEvent({ type: "thread", cardId: "copilot", index: 1, item: say("live") }));
    thread.mockResolvedValue({ items: [say("snapshot")] });
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.items).toEqual([say("snapshot")]));
  });

  it("shows a failed load", async () => {
    copilot.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce("offline");
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.error).toBe("down"));
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.error).toBe("offline"));
  });

  it("follows the copilot's live card, thread and streaming text, ignoring other cards", () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => {
      stream.onEvent({ type: "card", card: pilot({ column: "running" }) });
      stream.onEvent({ type: "card", card: { ...pilot(), id: "other" } });
      stream.onEvent({ type: "thread", cardId: "other", index: 0, item: say("not mine") });
      stream.onEvent({ type: "delta", cardId: "copilot", text: "Hel" });
      stream.onEvent({ type: "delta", cardId: "other", text: "x" });
      stream.onEvent({ type: "delta", cardId: "copilot", text: "lo" });
    });
    expect(result.current.card?.column).toBe("running");
    expect(result.current.streaming).toBe("Hello");
    act(() => stream.onEvent({ type: "thread", cardId: "copilot", index: 0, item: { kind: "user", text: "q", at: 1 } }));
    expect(result.current.streaming).toBe("Hello");
    act(() => stream.onEvent({ type: "thread", cardId: "copilot", index: 1, item: say("Hello") }));
    expect(result.current.streaming).toBe("");
    act(() => stream.onEvent({ type: "thread", cardId: "copilot", index: 1, item: say("Edited"), truncate: true }));
    expect(result.current.items).toEqual([{ kind: "user", text: "q", at: 1 }, say("Edited")]);
    act(() => stream.onEvent({ type: "card_deleted", id: "copilot" }));
    expect(result.current.card?.column).toBe("running");
  });

  it("sends to the copilot, clearing an earlier error", async () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => result.current.fail(new Error("oops")));
    expect(result.current.error).toBe("oops");
    act(() => result.current.fail("plain"));
    expect(result.current.error).toBe("plain");
    await act(() => result.current.send("what's up?"));
    expect(send).toHaveBeenCalledWith("copilot", "what's up?");
    expect(result.current.error).toBeNull();
  });

  it("starts a new chat", async () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onEvent({ type: "delta", cardId: "copilot", text: "partial" }));
    await act(() => result.current.newChat());
    expect(result.current.items).toEqual([]);
    expect(result.current.streaming).toBe("");
    expect(result.current.card?.column).toBe("backlog");
    expect(result.current.resetting).toBe(false);
  });

  it("switches persona as a new chat, and lets go of the lock when it fails", async () => {
    copilotPersona.mockResolvedValueOnce({ card: pilot({ persona: "founder" }) }).mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onEvent({ type: "delta", cardId: "copilot", text: "partial" }));
    await act(() => result.current.setPersona("founder"));
    expect(copilotPersona).toHaveBeenCalledWith("founder");
    expect(result.current.card?.persona).toBe("founder");
    expect(result.current.streaming).toBe("");
    await act(() => expect(result.current.setPersona("captain")).rejects.toThrow("down"));
    expect(result.current.resetting).toBe(false);
  });

  it("turns New chat off while the reset runs, and back on when it fails", async () => {
    let finish!: (value: { card: Card }) => void;
    resetCopilot.mockReturnValueOnce(new Promise((resolve) => (finish = resolve))).mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useCopilotThread());
    let pending!: Promise<void>;
    act(() => void (pending = result.current.newChat()));
    expect(result.current.resetting).toBe(true);
    await act(async () => {
      finish({ card: pilot({ column: "backlog" }) });
      await pending;
    });
    expect(result.current.resetting).toBe(false);
    await act(() => expect(result.current.newChat()).rejects.toThrow("down"));
    expect(result.current.resetting).toBe(false);
  });

  it("empties the conversation when the server clears the copilot's thread, ignoring other cards", () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => {
      stream.onEvent({ type: "thread", cardId: "copilot", index: 0, item: say("old") });
      stream.onEvent({ type: "delta", cardId: "copilot", text: "partial" });
      stream.onEvent({ type: "thread_cleared", cardId: "other" });
    });
    expect(result.current.items).toEqual([say("old")]);
    act(() => stream.onEvent({ type: "thread_cleared", cardId: "copilot" }));
    expect(result.current.items).toEqual([]);
    expect(result.current.streaming).toBe("");
  });

  it("draws a rename on the copilot's card at once, and on the card it loads", async () => {
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.id).toBe("copilot"));
    act(() => void patchNow("copilot", { title: "Renamed" }, () => new Promise(() => {})));
    expect(result.current.card?.title).toBe("Renamed");
    // A server card still shows the old title: the rename stays drawn.
    act(() => stream.onEvent({ type: "card", card: pilot({ title: "Copilot" }) }));
    expect(result.current.card?.title).toBe("Renamed");
    forget("copilot");
  });

  it("draws a rename on the copilot's card when it loads it", async () => {
    act(() => void patchNow("copilot", { title: "Renamed" }, () => new Promise(() => {})));
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.title).toBe("Renamed"));
    forget("copilot");
  });

  it("puts the old persona back when the server refuses the new one", async () => {
    copilot.mockResolvedValue({ card: pilot({ persona: "captain" }) });
    copilotPersona.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.persona).toBe("captain"));
    await act(() => expect(result.current.setPersona("founder")).rejects.toThrow("down"));
    expect(result.current.card?.persona).toBe("captain");
    expect(result.current.resetting).toBe(false);
  });

  it("shows the new persona at once, before the server answers", async () => {
    copilot.mockResolvedValue({ card: pilot({ persona: "captain" }) });
    let answer!: (value: { card: Card }) => void;
    copilotPersona.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.persona).toBe("captain"));
    act(() => void result.current.setPersona("founder"));
    expect(result.current.card?.persona).toBe("founder");
    await act(async () => {
      answer({ card: pilot({ persona: "founder" }) });
      await Promise.resolve();
    });
    expect(result.current.card?.persona).toBe("founder");
  });

  it("keeps the copilot's card when the overlay has nothing to draw", async () => {
    // A delete on the copilot: the overlay drops it, so the loaded and the live card are used as they are.
    remove.mockReturnValue(new Promise(() => {}));
    act(() => void removeNow("copilot"));
    const { result } = renderHook(() => useCopilotThread());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.id).toBe("copilot"));
    act(() => stream.onEvent({ type: "card", card: pilot({ column: "running" }) }));
    expect(result.current.card?.column).toBe("running");
  });

  it("draws nothing when the copilot is gone and something changes", async () => {
    const { result } = renderHook(() => useCopilotThread());
    // No copilot yet: an optimistic change leaves it empty.
    act(() => void patchNow("copilot", { title: "x" }, () => new Promise(() => {})));
    expect(result.current.card).toBeNull();
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.card?.id).toBe("copilot"));
    // A delete on it: the redraw has nothing to draw, and the copilot keeps its card.
    remove.mockReturnValue(new Promise(() => {}));
    act(() => void removeNow("copilot"));
    expect(result.current.card?.id).toBe("copilot");
  });
});

// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const copilot = vi.fn<() => Promise<{ card: Card }>>();
const remove = vi.fn<(id: string) => Promise<unknown>>();
const playChime = vi.fn<(kind: string) => void>();
vi.mock("./client", () => ({ api: { copilot: () => copilot(), remove: (id: string) => remove(id) } }));
vi.mock("./chimes", () => ({ playChime: (kind: string) => playChime(kind) }));

const { useCopilotCard } = await import("./use-copilot-card");
const { forget, patchNow, removeNow } = await import("./optimistic-cards");

const card = (column: Card["column"]) => ({ id: "pilot", role: "copilot", title: "Copilot", column }) as Card;

beforeEach(() => {
  copilot.mockReset();
  remove.mockReset().mockResolvedValue(undefined);
  playChime.mockReset();
  forget("pilot");
});

afterEach(cleanup);

describe("useCopilotCard", () => {
  it("starts with no copilot card", () => {
    const { result } = renderHook(() => useCopilotCard());
    expect(result.current.copilot).toBeNull();
  });

  it("loads the copilot card without a chime", async () => {
    copilot.mockResolvedValue({ card: card("needs_you") });
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.column).toBe("needs_you"));
    expect(playChime).not.toHaveBeenCalled();
  });

  it("ignores a failed load", async () => {
    copilot.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await Promise.resolve();
    expect(result.current.copilot).toBeNull();
  });

  it("chimes when a live update moves it into Needs you", () => {
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.update(card("running")));
    expect(playChime).not.toHaveBeenCalled();
    act(() => result.current.update(card("needs_you")));
    expect(playChime).toHaveBeenCalledWith("needs_you");
    expect(result.current.copilot?.column).toBe("needs_you");
  });

  it("doesn't chime again while it stays in Needs you", () => {
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.update(card("needs_you")));
    act(() => result.current.update(card("needs_you")));
    expect(playChime).not.toHaveBeenCalled();
  });

  it("draws a rename on the copilot at once, and keeps it while the server has the old one", async () => {
    copilot.mockResolvedValue({ card: card("running") });
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.column).toBe("running"));
    act(() => void patchNow("pilot", { title: "x" }, () => new Promise(() => {})));
    expect(result.current.copilot?.title).toBe("x");
  });

  it("keeps the rename on the copilot it loads", async () => {
    copilot.mockResolvedValue({ card: card("running") });
    act(() => void patchNow("pilot", { title: "x" }, () => new Promise(() => {})));
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.title).toBe("x"));
  });

  it("ignores a reload, and draws nothing when it has no copilot", async () => {
    copilot.mockResolvedValue({ card: card("running") });
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.column).toBe("running"));
    // A refused patch drops the rename and asks for a reload: the copilot keeps its own copy
    // (it doesn't fetch again; the board reloads).
    await act(async () => {
      await expect(patchNow("pilot", { title: "x" }, () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    });
    expect(result.current.copilot?.title).toBe("Copilot");
    expect(copilot).toHaveBeenCalledTimes(1);
    // With no copilot yet, an optimistic update leaves it null.
    const { result: empty } = renderHook(() => useCopilotCard());
    act(() => void patchNow("other", { title: "y" }, () => new Promise(() => {})));
    expect(empty.current.copilot).toBeNull();
    forget("other");
  });

  it("keeps the copilot it loads, even while the overlay drops it", async () => {
    copilot.mockResolvedValue({ card: card("running") });
    // A delete on the copilot: the overlay has nothing to draw, so the loaded card is used.
    remove.mockReturnValue(new Promise(() => {}));
    act(() => void removeNow("pilot"));
    const { result } = renderHook(() => useCopilotCard());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.copilot?.column).toBe("running"));
  });
});

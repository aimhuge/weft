// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url) }));

import { TEAM_IDLE_POLL_MS, TEAM_POLL_MS, teamPollDelay, useTeamBoard } from "./use-team-board";
import { FULL_READ_EVERY_MS } from "./worker-board-merge";

const card = (id: string) => ({ id, title: id }) as Card;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

const settle = () => act(async () => vi.advanceTimersByTimeAsync(0));

describe("teamPollDelay", () => {
  it("is fast only with cards and the board on screen", () => {
    expect(teamPollDelay({ signedIn: true, cards: [card("a")] }, false)).toBe(TEAM_POLL_MS);
    expect(teamPollDelay({ signedIn: true, cards: [card("a")] }, true)).toBe(TEAM_IDLE_POLL_MS);
    expect(teamPollDelay({ signedIn: true, cards: [] }, false)).toBe(TEAM_IDLE_POLL_MS);
  });
});

describe("useTeamBoard", () => {
  it("reads the whole board, then only what changed since, merged", async () => {
    fetchMock.mockReturnValueOnce(json({ signedIn: true, cards: [card("a"), card("b")], asOf: "t1" }));
    const { result, unmount } = renderHook(() => useTeamBoard());
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/team-board");
    expect(result.current.cards.map((c) => c.id)).toEqual(["a", "b"]);
    fetchMock.mockReturnValueOnce(json({ signedIn: true, cards: [card("c")], delta: true, removed: ["a"], asOf: "t2" }));
    await act(async () => vi.advanceTimersByTimeAsync(TEAM_POLL_MS));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/team-board?since=t1");
    expect(result.current.cards.map((c) => c.id)).toEqual(["b", "c"]);
    unmount();
  });

  it("keeps what's drawn through a failed read, and reads whole again every few minutes", async () => {
    fetchMock.mockReturnValueOnce(json({ signedIn: true, cards: [card("a")], asOf: "t1" }));
    const { result, unmount } = renderHook(() => useTeamBoard());
    await settle();
    fetchMock.mockReturnValue(json({ error: "x" }, 502));
    await act(async () => vi.advanceTimersByTimeAsync(TEAM_POLL_MS));
    expect(result.current.cards.map((c) => c.id)).toEqual(["a"]);
    fetchMock.mockRejectedValue(new Error("down"));
    await act(async () => vi.advanceTimersByTimeAsync(TEAM_POLL_MS));
    expect(result.current.cards.map((c) => c.id)).toEqual(["a"]);
    fetchMock.mockClear();
    fetchMock.mockReturnValue(json({ signedIn: true, cards: [card("a")], asOf: "t1" }));
    await act(async () => vi.advanceTimersByTimeAsync(FULL_READ_EVERY_MS + TEAM_POLL_MS * 2));
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/team-board");
    unmount();
  });

  it("looks once a minute with nothing to show, and at once when the board comes back on screen", async () => {
    fetchMock.mockReturnValue(json({ signedIn: false, cards: [] }));
    const { unmount } = renderHook(() => useTeamBoard());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(TEAM_POLL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden = true;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden = false;
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(TEAM_IDLE_POLL_MS * 2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops a read that lands after it's gone", async () => {
    let land: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((ok) => (land = ok)));
    const { result, unmount } = renderHook(() => useTeamBoard());
    unmount();
    land(new Response(JSON.stringify({ signedIn: true, cards: [card("a")] })));
    await settle();
    expect(result.current.cards).toEqual([]);
  });
});

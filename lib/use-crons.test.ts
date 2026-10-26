// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "./cron-types";
import type { BoardEvent } from "./types";

const cronApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  run: vi.fn(),
}));
vi.mock("./cron-client", () => ({ cronApi }));

// The hook's live-stream handlers, so a test can play the server's events.
const stream = vi.hoisted((): { onEvent: (event: BoardEvent) => void; onOpen: () => void } => ({
  onEvent: () => {},
  onOpen: () => {},
}));
vi.mock("./use-events", () => ({
  useBoardEvents: (onEvent: (event: BoardEvent) => void, onOpen: () => void) => {
    stream.onEvent = onEvent;
    stream.onOpen = onOpen;
  },
}));

const { useCrons } = await import("./use-crons");

const cron = (over: Partial<Cron> = {}): Cron => ({
  id: "c1",
  name: "Daily digest",
  prompt: "do the thing",
  expr: "0 9 * * *",
  mode: "fresh",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 0,
  runs: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  stream.onEvent = () => {};
  stream.onOpen = () => {};
  cronApi.list.mockResolvedValue([cron()]);
});
afterEach(cleanup);

describe("useCrons", () => {
  it("loads the crons when the live stream opens", async () => {
    const { result } = renderHook(() => useCrons());
    expect(cronApi.list).not.toHaveBeenCalled();
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toEqual([cron()]));
    expect(cronApi.list).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("reloads when the server says the crons changed, and not for anything else", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    act(() => stream.onEvent({ type: "card", card: {} as never }));
    expect(cronApi.list).toHaveBeenCalledTimes(1);
    act(() => stream.onEvent({ type: "crons" }));
    await waitFor(() => expect(cronApi.list).toHaveBeenCalledTimes(2));
  });

  it("reloads when the live stream opens again", async () => {
    renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(cronApi.list).toHaveBeenCalledTimes(1));
    act(() => stream.onOpen());
    await waitFor(() => expect(cronApi.list).toHaveBeenCalledTimes(2));
  });

  it("reports a failed load and clears the error on the next good one", async () => {
    cronApi.list.mockRejectedValueOnce(new Error("Server down"));
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.error).toBe("Server down"));
    expect(result.current.crons).toEqual([]);
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.crons).toEqual([cron()]);
  });

  it("says what went wrong when the failure isn't an Error", async () => {
    cronApi.list.mockRejectedValueOnce("plain");
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.error).toBe("plain"));
  });

  it("adds a cron that's made, and puts one that's changed in its place", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    const added = cron({ id: "c2", name: "Weekly" });
    cronApi.create.mockResolvedValue(added);
    await act(async () => expect(await result.current.create({ prompt: "p", expr: "0 9 * * *" })).toEqual(added));
    expect(cronApi.create).toHaveBeenCalledWith({ prompt: "p", expr: "0 9 * * *" });
    expect(result.current.crons.map((c) => c.id)).toEqual(["c1", "c2"]);

    const changed = cron({ id: "c1", name: "Renamed" });
    cronApi.update.mockResolvedValue(changed);
    await act(async () => result.current.update("c1", { name: "Renamed" }));
    expect(cronApi.update).toHaveBeenCalledWith("c1", { name: "Renamed" });
    expect(result.current.crons.map((c) => c.name)).toEqual(["Renamed", "Weekly"]);
    expect(result.current.crons).toHaveLength(2);
  });

  it("shows the change at once, before the server answers", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    // The update hangs until the test lets it answer.
    let answer: (c: Cron) => void = () => undefined;
    cronApi.update.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    act(() => {
      void result.current.update("c1", { name: "Renamed" });
    });
    // The patch is in the list while the call is still waiting.
    expect(result.current.crons[0]?.name).toBe("Renamed");
    expect(result.current.crons[0]?.enabled).toBe(true);
    await act(async () => {
      answer(cron({ name: "Renamed" }));
      await Promise.resolve();
    });
    expect(result.current.crons[0]?.name).toBe("Renamed");
  });

  it("reloads what the server has when a change is refused, and says why", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    expect(cronApi.list).toHaveBeenCalledTimes(1);
    cronApi.update.mockRejectedValueOnce(new Error("nope"));
    await act(() => expect(result.current.update("c1", { name: "Renamed" })).rejects.toThrow("nope"));
    // The refusal puts the old cron back and asks the server what it has.
    await waitFor(() => expect(cronApi.list).toHaveBeenCalledTimes(2));
    expect(result.current.crons[0]?.name).toBe("Daily digest");
  });

  it("takes a cron off the list when it's deleted", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    cronApi.remove.mockResolvedValue(undefined);
    await act(async () => result.current.remove("c1"));
    expect(cronApi.remove).toHaveBeenCalledWith("c1");
    expect(result.current.crons).toEqual([]);
  });

  it("runs a cron and hands the card back", async () => {
    const { result } = renderHook(() => useCrons());
    act(() => stream.onOpen());
    await waitFor(() => expect(result.current.crons).toHaveLength(1));
    const card = { id: "card1" };
    cronApi.run.mockResolvedValue(card);
    await act(async () => expect(await result.current.run("c1")).toEqual(card));
    expect(cronApi.run).toHaveBeenCalledWith("c1");
  });
});

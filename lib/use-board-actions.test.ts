// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const apiCreate = vi.fn<(...args: unknown[]) => Promise<{ card: Card | null; start?: { started: boolean; worker?: string } }>>();
const apiWarm = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const apiSettings = vi.fn<() => Promise<{ reviewAllModel: string }>>();
vi.mock("./client", () => ({
  api: {
    create: (...args: unknown[]) => apiCreate(...args),
    warm: (...args: unknown[]) => apiWarm(...args),
    settings: () => apiSettings(),
  },
}));

const startPileReview = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock("./pile-review", () => ({ startPileReview: (...args: unknown[]) => startPileReview(...args) }));

const lineWarm = vi.fn();
vi.mock("./line-host", () => ({ actOnLine: vi.fn(), lineTransport: vi.fn(() => ({})), lineFiles: vi.fn(() => ({})), warmOnLine: (...args: unknown[]) => { lineWarm(...args); } }));

const { useBoardActions } = await import("./use-board-actions");
const { openCardById } = await import("./open-card");

const card = (over: Partial<Card> = {}): Card =>
  ({ id: "c1", title: "T", column: "running", cwd: "/repo", tags: [], archived: false, starred: false, warm: false, ...over }) as Card;

function make(over: Partial<{ selected: Card | null; project: string | null; latestCwd: string | null; onSentToWorker: (worker: string) => void }> = {}) {
  const select = vi.fn();
  const setShowNew = vi.fn();
  const setNewCwd = vi.fn();
  const notify = vi.fn();
  const { result } = renderHook(() =>
    useBoardActions({
      selected: over.selected ?? null,
      select,
      setShowNew,
      setNewCwd,
      project: over.project ?? null,
      latestCwd: over.latestCwd ?? null,
      notify,
      onSentToWorker: over.onSentToWorker,
    }),
  );
  return { result, select, setShowNew, setNewCwd, notify };
}

beforeEach(() => {
  apiCreate.mockReset();
  apiCreate.mockResolvedValue({ card: card({ id: "new" }) });
  apiWarm.mockReset();
  apiWarm.mockResolvedValue({});
  apiSettings.mockReset();
  apiSettings.mockResolvedValue({ reviewAllModel: "" });
  startPileReview.mockReset();
  startPileReview.mockResolvedValue();
  localStorage.clear();
});

afterEach(cleanup);

describe("useBoardActions", () => {
  it("openNew sets newCwd and opens the dialog", () => {
    const { result, setShowNew, setNewCwd } = make({ project: "/p" });
    act(() => result.current.openNew("/x"));
    expect(setNewCwd).toHaveBeenCalledWith("/x");
    expect(setShowNew).toHaveBeenCalledWith(true);
  });

  it("openNew warms the folder CLI for the chosen folder", () => {
    const { result } = make({ project: "/p" });
    act(() => result.current.openNew("/x"));
    expect(apiWarm).toHaveBeenCalledWith({ cwd: "/x" });
  });

  it("openNew falls back to the project, then to the last folder in localStorage", () => {
    localStorage.setItem("threadboard.cwd", "/last");
    const { result } = make({ project: null });
    act(() => result.current.openNew());
    expect(apiWarm).toHaveBeenCalledWith({ cwd: "/last" });
  });

  it("selects a card a thread asks to open", () => {
    const { select } = make();
    act(() => openCardById("handed"));
    expect(select).toHaveBeenCalledWith("handed");
  });

  it("openCard selects the card", () => {
    const { result, select } = make();
    const c = card({ id: "x" });
    act(() => result.current.openCard(c));
    expect(select).toHaveBeenCalledWith("x");
  });

  it("openCard warms the card's CLI when not warm and not done", () => {
    const { result } = make();
    act(() => result.current.openCard(card({ id: "x", warm: false, column: "running" })));
    expect(apiWarm).toHaveBeenCalledWith({ cardId: "x" });
  });

  it("openCard warms a worker card on its own host, never through this Mac's /api/warm", () => {
    const { result } = make();
    act(() => result.current.openCard(card({ id: "k", cwd: "worker://w1/ling" })));
    expect(apiWarm).not.toHaveBeenCalled();
    expect(lineWarm).toHaveBeenCalledWith("w1", "k");
  });

  it("openCard does not warm a warm or done card", () => {
    const { result } = make();
    act(() => result.current.openCard(card({ id: "w", warm: true })));
    act(() => result.current.openCard(card({ id: "d", column: "done" })));
    expect(apiWarm).not.toHaveBeenCalled();
  });

  it("create calls api.create with the input", async () => {
    const { result } = make();
    await act(async () => {
      await result.current.create({ title: "T", prompt: "p", cwd: "/c", backend: "claude", start: true });
    });
    expect(apiCreate).toHaveBeenCalledWith({ title: "T", prompt: "p", cwd: "/c", backend: "claude", start: true });
  });

  it("improveQuality returns the new card's id", async () => {
    const { result } = make();
    let id: string | undefined;
    await act(async () => {
      id = await result.current.improveQuality("/c", "p", "T", "model");
    });
    expect(id).toBe("new");
    expect(apiCreate).toHaveBeenCalledWith({ title: "T", prompt: "p", cwd: "/c", backend: "claude", model: "model", start: true });
  });

  it("improveQuality on a worker's project sends the card there, with no card here to open", async () => {
    const onSentToWorker = vi.fn();
    apiCreate.mockResolvedValueOnce({ card: null, start: { started: false, worker: "m1mini" } });
    const { result } = make({ onSentToWorker });
    let id: string | undefined = "x";
    await act(async () => {
      id = await result.current.improveQuality("worker://w1/ling", "p", "T");
    });
    expect(id).toBeUndefined();
    expect(onSentToWorker).toHaveBeenCalledWith("m1mini");
  });

  it("reviewAll resolves with no cwd and skips work", async () => {
    const { result } = make({ project: null, latestCwd: null });
    await act(async () => {
      await result.current.reviewAll();
    });
    expect(startPileReview).not.toHaveBeenCalled();
  });

  it("reviewAll uses selected.cwd and passes the saved model through", async () => {
    apiSettings.mockResolvedValue({ reviewAllModel: "sonnet" });
    const selected = card({ id: "sel", cwd: "/sel" });
    const { result, select } = make({ selected, project: null, latestCwd: null });
    await act(async () => {
      await result.current.reviewAll();
    });
    expect(startPileReview).toHaveBeenCalledTimes(1);
    const [cwd, start, open] = startPileReview.mock.calls[0] as [string, (c: string, p: string, t: string) => Promise<string | undefined>, (id: string) => void];
    expect(cwd).toBe("/sel");
    const started = await start("/sel", "p", "T");
    expect(started).toBe("new");
    open("some-id");
    expect(select).toHaveBeenCalledWith("some-id");
  });

  it("reviewAll falls back to project, then to latestCwd", async () => {
    const { result } = make({ project: "/proj", latestCwd: "/lat" });
    await act(async () => {
      await result.current.reviewAll();
    });
    const [cwd] = startPileReview.mock.calls[0] as [string];
    expect(cwd).toBe("/proj");
  });

  it("reviewAll catches errors and reports them via notify", async () => {
    startPileReview.mockRejectedValue(new Error("boom"));
    const { result, notify } = make({ project: "/p" });
    await act(async () => {
      await result.current.reviewAll();
    });
    expect(notify).toHaveBeenCalled();
  });
});
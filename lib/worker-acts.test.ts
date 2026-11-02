// @vitest-environment jsdom
// A card's actions on a Weft Worker (lib/worker-acts.ts): sent as host commands, followed with a backoff, reported as
// queued when the worker doesn't take them, and never sent twice while the same one is on its way.
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string, init?: RequestInit) => fetchMock(url, init) }));

const { ACT_WAIT, actOnWorker, postWorkerAction, useWorkerQueued } = await import("./worker-acts");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string) as unknown);
const reads = () => fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/workers?command=")).length;

// The worker's answers to each read of the command, in turn; the last one repeats.
function worker(...statuses: { status: string; error?: string | null }[]) {
  fetchMock.mockImplementation((url) => {
    if (!url.startsWith("/api/workers")) return Promise.resolve(json({ commandId: "cmd-1" }));
    const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    return Promise.resolve(json({ error: null, ...next }));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("postWorkerAction", () => {
  it("throws the server's error, or its status", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "That thread isn't on one of your workers." }, 400));
    await expect(postWorkerAction({ action: "stop", cardId: "c1" })).rejects.toThrow("That thread isn't on one of your workers.");
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(postWorkerAction({ action: "stop", cardId: "c1" })).rejects.toThrow("HTTP 500");
  });
});

describe("actOnWorker", () => {
  it("sends the verb as a host command and follows it until the worker ran it", async () => {
    worker({ status: "done" });
    await expect(actOnWorker("card.update", { id: "c1", body: { starred: true } })).resolves.toBeUndefined();
    expect(posts()).toEqual([{ action: "host", cardId: "c1", verb: "card.update", args: { id: "c1", body: { starred: true } } }]);
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/workers?command=cmd-1");
  });

  it("rejects with the worker's refusal, or says so plainly", async () => {
    worker({ status: "failed", error: "Move it to Review first." });
    await expect(actOnWorker("card.update", { id: "c1", body: { column: "done" } })).rejects.toThrow("Move it to Review first.");
    worker({ status: "failed", error: null });
    await expect(actOnWorker("card.stop", { id: "c2" })).rejects.toThrow("Your worker couldn't do that.");
  });

  it("doesn't follow what has no command, and lets a send that failed be sent again", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await actOnWorker("card.stop", { id: "c3" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(actOnWorker("card.stop", { id: "c3" })).rejects.toThrow("offline");
    fetchMock.mockResolvedValueOnce(json({}));
    await actOnWorker("card.stop", { id: "c3" });
    expect(posts()).toHaveLength(3);
  });

  it("backs off between reads, rather than reading every half second", async () => {
    vi.useFakeTimers();
    worker({ status: "claimed" }, { status: "claimed" }, { status: "claimed" }, { status: "claimed" }, { status: "done" });
    const done = actOnWorker("card.stop", { id: "c4" });
    await vi.advanceTimersByTimeAsync(500 + 1_000 + 2_000 + 4_000);
    await expect(done).resolves.toBeUndefined();
    expect(reads()).toBe(5);
    expect(ACT_WAIT.every(10)).toBe(4_000);
  });

  it("rides out a failed read", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json({ commandId: "cmd-1" })).mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json({ status: "done", error: null }));
    const done = actOnWorker("card.stop", { id: "c5" });
    await vi.advanceTimersByTimeAsync(500);
    await expect(done).resolves.toBeUndefined();
  });

  it("says a command the worker hasn't taken is queued, counts it on the card, and settles it when the worker runs it", async () => {
    vi.useFakeTimers();
    worker({ status: "pending" });
    const queued = renderHook(() => useWorkerQueued("c6"));
    const sent = actOnWorker("card.update", { id: "c6", body: { starred: true } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACT_WAIT.unclaimed + 4_000);
    });
    const result = await sent;
    expect(result?.queued).toBeInstanceOf(Promise);
    expect(queued.result.current).toBe(1);
    // The same action again joins the queued one: no second command.
    expect(await actOnWorker("card.update", { id: "c6", body: { starred: true } })).toBe(result);
    expect(posts()).toHaveLength(1);
    worker({ status: "done" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await expect(result!.queued).resolves.toBeUndefined();
    expect(queued.result.current).toBe(0);
    queued.unmount();
    // Once it ran, the same action is a new command.
    worker({ status: "done" });
    await actOnWorker("card.update", { id: "c6", body: { starred: true } });
    expect(posts()).toHaveLength(2);
  });

  it("takes a queued change back when the worker refuses it later", async () => {
    vi.useFakeTimers();
    worker({ status: "pending" });
    const sent = actOnWorker("card.restart", { id: "c7" });
    await vi.advanceTimersByTimeAsync(ACT_WAIT.unclaimed + 4_000);
    const result = await sent;
    worker({ status: "failed", error: "gone" });
    const refused = expect(result!.queued).rejects.toThrow("gone");
    await vi.advanceTimersByTimeAsync(15_000);
    await refused;
  });

  it("sends an opposite action after the first, for the worker to run in order", async () => {
    worker({ status: "done" });
    await Promise.all([actOnWorker("card.update", { id: "c8", body: { starred: true } }), actOnWorker("card.update", { id: "c8", body: { starred: false } })]);
    expect(posts()).toHaveLength(2);
  });
});

describe("useWorkerQueued", () => {
  it("counts nothing on the server", () => {
    function Count() {
      return createElement("span", null, useWorkerQueued("c1"));
    }
    expect(renderToString(createElement(Count))).toBe("<span>0</span>");
  });
});

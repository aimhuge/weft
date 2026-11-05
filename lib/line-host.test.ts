// @vitest-environment jsdom
// CloudHost's two routes (lib/line-host.ts): the session line when it's up, the relay when it isn't, and never both
// for one verb; the open thread hears the line's events instead of polling.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineEvent } from "./host-line-protocol";
import type { LineRoute } from "./session-line";
import { LineDown, LineLost } from "./session-line-calls";
import type { ThreadPage } from "./thread-page";

const actOnWorker = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
const askWorker = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true, cardId: "c1", value: { files: ["relay.ts"] } })));
vi.mock("./worker-acts", () => ({ actOnWorker, askWorker }));
const polls = vi.hoisted(() => [] as (boolean | undefined)[]);
vi.mock("./worker-transport", () => ({
  useWorkerLive: (_: string, __: unknown, poll?: boolean) => void polls.push(poll),
  workerTransportVia: (act: unknown, useLive: unknown, files: unknown) => ({ act, useLive, files }),
}));
const state = vi.hoisted(() => ({
  line: null as null | { up: () => boolean; call: ReturnType<typeof vi.fn>; onEvent: (fn: (e: LineEvent) => void) => () => void },
  route: null as LineRoute | null,
  listeners: new Set<(e: LineEvent) => void>(),
}));
vi.mock("./session-lines", () => ({ lineFor: () => state.line, useLineRoute: () => state.route }));

const { actOnLine, askOnLine, lineFiles, lineTransport, useLineLive, warmOnLine } = await import("./line-host");

function line(up = true) {
  state.line = {
    up: () => up,
    call: vi.fn(() => Promise.resolve({ ok: true, cardId: "c1" })),
    onEvent: (fn) => (state.listeners.add(fn), () => void state.listeners.delete(fn)),
  };
  return state.line;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.line = null;
  state.route = null;
  state.listeners.clear();
  polls.length = 0;
});
afterEach(cleanup);

describe("actOnLine", () => {
  it("takes the line when it's up, and settles at once", async () => {
    const l = line();
    await expect(actOnLine("w1", "card.stop", { id: "c1" })).resolves.toBeUndefined();
    expect(l.call).toHaveBeenCalledWith("card.stop", { id: "c1" });
    expect(actOnWorker).not.toHaveBeenCalled();
  });

  it("takes the relay with no line, a line that's down, or text that pastes files", async () => {
    await actOnLine("w1", "card.stop", { id: "c1" });
    line(false);
    await actOnLine("w1", "card.stop", { id: "c1" });
    const l = line();
    await actOnLine("w1", "card.message", { id: "c1", text: "look ![shot](/Users/me/.weft/attachments/shot-1a2b3c4d.png)" });
    expect(actOnWorker).toHaveBeenCalledTimes(3);
    expect(l.call).not.toHaveBeenCalled();
  });

  it("takes the relay for a verb the line couldn't send, but not for one it lost or the worker refused", async () => {
    const l = line();
    l.call.mockRejectedValueOnce(new LineDown());
    await actOnLine("w1", "card.stop", { id: "c1" });
    expect(actOnWorker).toHaveBeenCalledTimes(1);
    l.call.mockRejectedValueOnce(new LineLost());
    await expect(actOnLine("w1", "card.stop", { id: "c1" })).rejects.toBeInstanceOf(LineLost);
    l.call.mockRejectedValueOnce(new Error("A shell command only runs from Weft's own window, not from the web."));
    await expect(actOnLine("w1", "card.shell", { id: "c1" })).rejects.toThrow("only runs");
    expect(actOnWorker).toHaveBeenCalledTimes(1);
  });
});

describe("warmOnLine", () => {
  it("warms a card only over a line that's up, never as a row, and shrugs off a failure", async () => {
    warmOnLine("w1", "c1");
    line(false);
    warmOnLine("w1", "c1");
    const l = line();
    l.call.mockRejectedValueOnce(new Error("gone"));
    warmOnLine("w1", "c1");
    await Promise.resolve();
    expect(l.call).toHaveBeenCalledWith("card.warm", { id: "c1" });
    expect(actOnWorker).not.toHaveBeenCalled();
  });
});

describe("useLineLive", () => {
  const page: ThreadPage = { items: [{ kind: "user", text: "a", at: 1 } as never], start: 0, total: 1 };

  it("polls while on the relay, hears the line's events while direct, and re-reads whenever the route changes", () => {
    line();
    const updates: ((p: ThreadPage) => ThreadPage)[] = [];
    const reconnect = vi.fn();
    const { rerender } = renderHook(() => useLineLive("w1", "c1", (u) => updates.push(u), reconnect));
    expect(polls.at(-1)).toBe(true);
    expect(reconnect).not.toHaveBeenCalled();
    state.route = { kind: "direct", ms: 3 };
    rerender();
    expect(polls.at(-1)).toBe(false);
    expect(reconnect).toHaveBeenCalledTimes(1);
    act(() => {
      state.listeners.forEach((fn) => fn({ t: "thread", cardId: "c1", index: 1, item: { kind: "assistant", text: "b", at: 2 } as never }));
      state.listeners.forEach((fn) => fn({ t: "thread", cardId: "c2", index: 1, item: {} as never }));
      state.listeners.forEach((fn) => fn({ t: "thread_cleared", cardId: "c2" }));
      state.listeners.forEach((fn) => fn({ t: "thread_cleared", cardId: "c1" }));
      state.listeners.forEach((fn) => fn({ t: "card_deleted", id: "c1" }));
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]!(page).total).toBe(2);
    expect(updates[1]!(page)).toEqual({ items: [], start: 0, total: 0 });
    state.route = { kind: "relay" };
    rerender();
    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(state.listeners.size).toBe(0);
  });

  it("types out the reply as it streams, ends it when it lands, and clears it when the line goes", () => {
    line();
    state.route = { kind: "direct", ms: 3 };
    const shown: string[] = [];
    const { rerender } = renderHook(() => useLineLive("w1", "c1", vi.fn(), vi.fn(), (text) => shown.push(text)));
    const hear = (e: LineEvent) => act(() => state.listeners.forEach((fn) => fn(e)));
    hear({ t: "delta", cardId: "c1", index: 1, text: "Hel" });
    hear({ t: "delta", cardId: "c2", index: 1, text: "other" });
    hear({ t: "delta", cardId: "c1", index: 1, text: "lo " });
    hear({ t: "thread", cardId: "c1", index: 1, item: { kind: "assistant", text: "Hello", at: 2 } as never });
    hear({ t: "delta", cardId: "c1", index: 3, text: "Next " });
    expect(shown).toEqual(["Hel", "Hello ", "", "Next "]);
    state.route = { kind: "relay" };
    rerender();
    expect(shown.at(-1)).toBe("");
    // Nothing was streaming: the next route change says nothing.
    state.route = { kind: "direct", ms: 3 };
    rerender();
    state.route = { kind: "relay" };
    rerender();
    expect(shown).toHaveLength(5);
  });

  it("hears nothing when the line went between the route and the read", () => {
    state.route = { kind: "direct", ms: 1 };
    expect(() => renderHook(() => useLineLive("w1", "c1", vi.fn(), vi.fn()))).not.toThrow();
  });
});

describe("lineTransport", () => {
  it("is one per worker, acting and listening through that worker's line", async () => {
    const t = lineTransport("w1") as unknown as { act: (verb: string, args: unknown) => Promise<unknown>; useLive: (...a: unknown[]) => void };
    expect(lineTransport("w1")).toBe(t);
    expect(lineTransport("w2")).not.toBe(t);
    const l = line();
    await t.act("card.stop", { id: "c1" });
    expect(l.call).toHaveBeenCalled();
    renderHook(() => t.useLive("c1", vi.fn(), vi.fn(), vi.fn()));
    expect(polls.at(-1)).toBe(true);
  });
});

describe("the editor's verbs over the line", () => {
  it("asks on the line when it's up, its result read like the relay's", async () => {
    const l = line();
    l.call.mockResolvedValueOnce({ ok: true, cardId: "c1", value: { files: ["line.ts"] } });
    await expect(lineFiles("w-files").list("c1")).resolves.toEqual(["line.ts"]);
    expect(l.call).toHaveBeenCalledWith("files.list", { id: "c1" });
    expect(askWorker).not.toHaveBeenCalled();
    expect(lineFiles("w-files")).toBe(lineFiles("w-files"));
    expect((lineTransport("w-files") as unknown as { files: unknown }).files).toBe(lineFiles("w-files"));
    expect(lineFiles("w-files").watch).toBeTypeOf("function");
  });

  it("takes the relay with no line, or one that couldn't send, and passes any other failure on", async () => {
    await expect(askOnLine("w1", "files.list", { id: "c1" })).resolves.toMatchObject({ value: { files: ["relay.ts"] } });
    const l = line();
    l.call.mockRejectedValueOnce(new LineDown());
    await expect(askOnLine("w1", "files.list", { id: "c1" })).resolves.toMatchObject({ value: { files: ["relay.ts"] } });
    l.call.mockRejectedValueOnce(new LineLost());
    await expect(askOnLine("w1", "files.read", { id: "c1", path: "a.ts" })).rejects.toThrow();
    expect(askWorker).toHaveBeenCalledTimes(2);
  });
});

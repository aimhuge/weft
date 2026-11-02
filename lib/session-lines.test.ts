// @vitest-environment jsdom
// The board's session lines (lib/session-lines.ts): one per worker, shared, held while something shows it, closed a
// while after the last lets go; the route the chip reads.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineEvent } from "./host-line-protocol";
import type { LineRoute, SessionLine } from "./session-line";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));
const postWorkerAction = vi.hoisted(() => vi.fn(() => Promise.resolve({ commandId: "cmd" })));
vi.mock("./worker-acts", () => ({ postWorkerAction }));
const listenForAnswer = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("./line-answer", () => ({ listenForAnswer, lineToken: () => "tok" }));

const { closeLines, LINGER_MS, lineFor, onLineEvents, retainLine, useLineRoute, useSessionLine } = await import("./session-lines");
const { getWorkerRoute, resetWorkerRoute } = await import("./worker-route");

function fakeLine() {
  let route: LineRoute = { kind: "connecting" };
  const routes = new Set<() => void>();
  const events = new Set<(e: LineEvent) => void>();
  const close = vi.fn();
  const line = {
    route: () => route,
    onRoute: (fn: () => void) => (routes.add(fn), () => void routes.delete(fn)),
    onEvent: (fn: (e: LineEvent) => void) => (events.add(fn), () => void events.delete(fn)),
    close,
  } as unknown as SessionLine;
  return {
    line,
    close,
    set: (next: LineRoute) => {
      route = next;
      routes.forEach((fn) => fn());
    },
    emit: (e: LineEvent) => events.forEach((fn) => fn(e)),
  };
}

let made: ReturnType<typeof fakeLine>[];
const make = vi.fn(() => {
  const f = fakeLine();
  made.push(f);
  return f.line;
});

beforeEach(() => {
  made = [];
  make.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  closeLines();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("retainLine", () => {
  it("shares one line per worker, and closes it a while after the last lets go, unless held again", () => {
    const a = retainLine("w1", make);
    const b = retainLine("w1", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(lineFor("w1")).toBe(made[0]!.line);
    expect(lineFor(null)).toBeNull();
    a();
    a();
    b();
    vi.advanceTimersByTime(LINGER_MS - 1);
    const c = retainLine("w1", make);
    vi.advanceTimersByTime(LINGER_MS);
    expect(made[0]!.close).not.toHaveBeenCalled();
    c();
    vi.advanceTimersByTime(LINGER_MS);
    expect(made[0]!.close).toHaveBeenCalled();
    expect(lineFor("w1")).toBeNull();
  });

  it("leaves a line made again after closeLines alone", () => {
    const a = retainLine("w1", make);
    a();
    closeLines();
    retainLine("w1", make);
    vi.advanceTimersByTime(LINGER_MS);
    expect(lineFor("w1")).toBe(made[1]!.line);
  });

  it("hands every line's events on, named by worker", () => {
    retainLine("w1", make);
    const heard = vi.fn();
    const off = onLineEvents(heard);
    made[0]!.emit({ t: "card_deleted", id: "c1" });
    expect(heard).toHaveBeenCalledWith("w1", { t: "card_deleted", id: "c1" });
    off();
    made[0]!.emit({ t: "card_deleted", id: "c2" });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("the hooks", () => {
  it("hold the line while mounted and read its route as it changes", () => {
    const { result, unmount } = renderHook(() => {
      useSessionLine("w1", make);
      return useLineRoute("w1");
    });
    expect(result.current).toEqual({ kind: "connecting" });
    resetWorkerRoute();
    act(() => made[0]!.set({ kind: "direct", ms: null }));
    expect(getWorkerRoute("w1")).toBeNull();
    act(() => made[0]!.set({ kind: "direct", ms: 4 }));
    expect(result.current).toEqual({ kind: "direct", ms: 4 });
    // The worker chip's tooltip reads it (lib/worker-route.ts).
    expect(getWorkerRoute("w1")).toMatchObject({ via: "direct", ms: 4 });
    unmount();
    vi.advanceTimersByTime(LINGER_MS);
    expect(made[0]!.close).toHaveBeenCalled();
  });

  it("hold nothing for no worker, or where there's no WebRTC", () => {
    renderHook(() => useSessionLine(null, make));
    vi.stubGlobal("RTCPeerConnection", undefined);
    renderHook(() => useSessionLine("w1"));
    expect(make).not.toHaveBeenCalled();
    expect(lineFor("w1")).toBeNull();
    expect(renderHook(() => useLineRoute(undefined)).result.current).toBeNull();
  });
});

describe("the real line", () => {
  class Pc {
    iceGatheringState = "complete";
    localDescription = { sdp: "offer" };
    createDataChannel = () => ({});
    addEventListener() {}
    createOffer = () => Promise.resolve({});
    setLocalDescription = () => Promise.resolve();
    close() {}
  }

  it("mints its ICE servers here, and sends its offer through this Mac's server", async () => {
    vi.useRealTimers();
    vi.stubGlobal("RTCPeerConnection", Pc);
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ iceServers: [{ urls: "turn:t" }] })));
    renderHook(() => useSessionLine("w1"));
    await vi.waitFor(() => expect(postWorkerAction).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/api/rtc-ice");
    expect(postWorkerAction).toHaveBeenCalledWith({ action: "line", workerId: "w1", offer: expect.objectContaining({ topic: "worker-line:tok", ice: [{ urls: "turn:t" }] }) as unknown });
    expect(listenForAnswer).toHaveBeenCalledWith("worker-line:tok", expect.any(Function));
    closeLines();
    postWorkerAction.mockClear();
    apiFetch.mockResolvedValueOnce(new Response("no", { status: 403 }));
    renderHook(() => useSessionLine("w2"));
    await vi.waitFor(() => expect(postWorkerAction).toHaveBeenCalledWith(expect.objectContaining({ offer: expect.objectContaining({ ice: [{ urls: "stun:stun.cloudflare.com:3478" }] }) as unknown })));
  });
});

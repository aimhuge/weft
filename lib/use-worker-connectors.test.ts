// @vitest-environment jsdom
// The Connectors hook behind Settings → Devices (lib/use-worker-connectors.ts): its reads of /api/devices/connectors,
// Connect in the pane, changes and Allows through main's bridge, and Turn off and Disconnect through the route.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DEFAULT_SETTINGS } from "./connector-grant";
import type { ConnectorsView } from "./connector-view";
import type { ConnectorsBridge } from "./use-worker-connectors";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));
const openInPane = vi.hoisted(() => vi.fn());
vi.mock("./open-in-pane", () => ({ openInPane }));

const { connectorsBridge, useWorkerConnectors } = await import("./use-worker-connectors");

const VIEW: ConnectorsView = { signedIn: true, github: { connected: true, login: "ada" }, connectUrl: "https://weft.zip/api/connectors/github/start", workers: {} };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const PENDING = { kind: "card" as const, subject: "c1", label: "Fix the login" };
let bridge: { set: Mock<ConnectorsBridge["set"]>; allow: Mock<ConnectorsBridge["allow"]> };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(() => json(VIEW));
  openInPane.mockReset();
  bridge = { set: vi.fn<ConnectorsBridge["set"]>(() => Promise.resolve({ ok: true })), allow: vi.fn<ConnectorsBridge["allow"]>(() => Promise.resolve({ ok: true })) };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { weft?: unknown }).weft;
});

async function loaded(o: { bridge?: typeof bridge } = { bridge }) {
  const h = renderHook(() => useWorkerConnectors(o.bridge));
  await waitFor(() => expect(h.result.current.view).toEqual(VIEW));
  return h;
}

describe("connectorsBridge", () => {
  it("is main's bridge in the desktop app, else nothing", () => {
    expect(connectorsBridge()).toBeUndefined();
    (window as unknown as { weft: unknown }).weft = { connectors: bridge };
    expect(connectorsBridge()).toBe(bridge);
    vi.stubGlobal("window", undefined);
    expect(connectorsBridge()).toBeUndefined();
  });

  it("is what the hook uses by default", async () => {
    (window as unknown as { weft: unknown }).weft = { connectors: bridge };
    const { result } = renderHook(() => useWorkerConnectors());
    expect(result.current.canChange).toBe(true);
    await waitFor(() => expect(result.current.view).toEqual(VIEW));
  });
});

describe("reading", () => {
  it("loads the view, then again every 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await loaded();
    expect(apiFetch).toHaveBeenCalledWith("/api/devices/connectors");
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("says why a read failed, by the route's error or its status", async () => {
    apiFetch.mockImplementationOnce(() => json({ error: "Couldn't read your connectors: no table" }, 502));
    const a = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(a.result.current.error).toBe("Couldn't read your connectors: no table"));
    apiFetch.mockImplementationOnce(() => Promise.resolve(new Response("nope", { status: 500 })));
    const b = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(b.result.current.error).toBe("HTTP 500"));
  });

  it("drops a read or a failure that lands after it closed", async () => {
    let finish: (r: Response) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
    const a = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    a.unmount();
    finish(new Response(JSON.stringify(VIEW)));
    let fail: (r: Response) => void = () => {};
    apiFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (fail = resolve)));
    const b = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    b.unmount();
    fail(new Response("nope", { status: 500 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(a.result.current.view).toBeNull();
    expect(b.result.current.error).toBeNull();
  });
});

describe("changes", () => {
  it("opens Connect GitHub in the browser pane once the view is in", async () => {
    const early = renderHook(() => useWorkerConnectors(bridge));
    act(() => early.result.current.connect());
    expect(openInPane).not.toHaveBeenCalled();
    expect(early.result.current.note).toBe("Connect GitHub in the browser pane, then come back here.");
    const { result } = await loaded();
    act(() => result.current.connect());
    expect(openInPane).toHaveBeenCalledWith(VIEW.connectUrl);
  });

  it("turns GitHub on or changes it through main, and says when Touch ID was declined", async () => {
    const { result } = await loaded();
    await act(() => result.current.set("w1", "m1mini", DEFAULT_SETTINGS));
    expect(bridge.set).toHaveBeenCalledWith("w1", "m1mini", "github", DEFAULT_SETTINGS);
    expect(result.current.note).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    bridge.set.mockResolvedValueOnce({ denied: true });
    await act(() => result.current.set("w1", "m1mini", DEFAULT_SETTINGS));
    expect(result.current.note).toBe("Not changed: that needs Touch ID.");
  });

  it("allows a waiting card through main", async () => {
    const { result } = await loaded();
    await act(() => result.current.allow("m1mini", "g1", PENDING));
    expect(bridge.allow).toHaveBeenCalledWith("g1", "m1mini", "card", "c1", "Fix the login");
    bridge.allow.mockResolvedValueOnce({ denied: true });
    await act(() => result.current.allow("m1mini", "g1", PENDING));
    expect(result.current.note).toBe("Not changed: an Allow needs Touch ID.");
  });

  it("refuses changes and Allows outside Weft's own window", async () => {
    const { result } = await loaded({});
    expect(result.current.canChange).toBe(false);
    await act(() => result.current.set("w1", "m1mini", DEFAULT_SETTINGS));
    expect(result.current.error).toBe("Turn connectors on from Weft's own window.");
    await act(() => result.current.allow("m1mini", "g1", PENDING));
    expect(result.current.error).toBe("Allow from Weft's own window.");
  });

  it("turns GitHub off through the route and says what GitHub confirmed", async () => {
    const { result } = await loaded();
    apiFetch.mockImplementationOnce(() => json({ ok: true, note: "GitHub off · 1 token revoked ✓" }));
    await act(() => result.current.off("w 1", "m1mini"));
    expect(apiFetch).toHaveBeenCalledWith("/api/devices/connectors?worker=w%201", { method: "DELETE" });
    expect(result.current.note).toBe("m1mini: GitHub off · 1 token revoked ✓");
    apiFetch.mockImplementationOnce(() => json({ ok: true }));
    await act(() => result.current.off("w1", "m1mini"));
    expect(result.current.note).toBe("m1mini: GitHub off");
    apiFetch.mockImplementationOnce(() => json({ error: "Couldn't reach weft.zip." }, 502));
    await act(() => result.current.off("w1", "m1mini"));
    expect(result.current.error).toBe("Couldn't reach weft.zip.");
  });

  it("disconnects GitHub, and says whether GitHub confirmed it", async () => {
    const { result } = await loaded();
    apiFetch.mockImplementationOnce(() => json({ grants: 1, authorization: "deleted" }));
    await act(() => result.current.disconnect());
    expect(apiFetch).toHaveBeenCalledWith("/api/devices/connectors?all=1", { method: "DELETE" });
    expect(result.current.note).toBe("GitHub disconnected: GitHub confirmed Weft's authorization is gone.");
    apiFetch.mockImplementationOnce(() => json({ grants: 1, authorization: "unconfirmed" }));
    await act(() => result.current.disconnect());
    expect(result.current.note).toMatch(/GitHub didn't confirm, so remove Weft at github.com\/settings\/apps\/authorizations/);
  });

  it("keeps no note or error from a change that lands after it closed", async () => {
    const { result, unmount } = await loaded();
    let said: (r: { ok?: boolean; denied?: boolean }) => void = () => {};
    bridge.set.mockReturnValueOnce(new Promise((resolve) => (said = resolve)));
    const pending = result.current.set("w1", "m1mini", DEFAULT_SETTINGS);
    let refuse: (e: Error) => void = () => {};
    bridge.allow.mockReturnValueOnce(new Promise((_, reject: (e: Error) => void) => (refuse = reject)));
    const failing = result.current.allow("m1mini", "g1", PENDING);
    unmount();
    said({ denied: true });
    refuse(new Error("late"));
    await Promise.all([pending, failing]);
    expect(result.current.note).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

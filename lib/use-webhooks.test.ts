// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Webhook } from "./webhooks";

const api = vi.hoisted(() => ({
  webhooks: vi.fn(),
  addWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  removeWebhook: vi.fn(),
  relayWebhook: vi.fn(),
  unrelayWebhook: vi.fn(),
}));
vi.mock("./client", () => ({ api }));

const { POLL_MS, addWebhookAsk, onWebhookAsk, useWebhooks } = await import("./use-webhooks");

const hook = (over: Partial<Webhook> = {}): Webhook => ({ id: "w1", folder: "/a", name: "stripe", target: "http://localhost:3000/x", createdAt: 0, updatedAt: 0, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  api.webhooks.mockResolvedValue({ hooks: [hook()], signedIn: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useWebhooks", () => {
  it("loads the folders' webhooks, again on focus and when the folders change", async () => {
    const { result, rerender } = renderHook(({ folders }) => useWebhooks(folders), { initialProps: { folders: ["/a", "/b"] } });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(api.webhooks).toHaveBeenCalledWith(["/a", "/b"]);
    expect(result.current).toMatchObject({ hooks: [hook()], signedIn: true, error: null });
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(api.webhooks).toHaveBeenCalledTimes(2));
    rerender({ folders: ["/c"] });
    await waitFor(() => expect(api.webhooks).toHaveBeenLastCalledWith(["/c"]));
  });

  it("asks for nothing with no folders", async () => {
    const { result } = renderHook(() => useWebhooks([]));
    await act(() => result.current.reload());
    expect(api.webhooks).not.toHaveBeenCalled();
    expect(result.current.loaded).toBe(false);
  });

  it("reports errors and clears them on the next answer", async () => {
    api.webhooks.mockRejectedValueOnce(new Error("Server down"));
    const { result } = renderHook(() => useWebhooks(["/a"]));
    await waitFor(() => expect(result.current.error).toBe("Server down"));
    api.webhooks.mockRejectedValueOnce("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBe("plain");
    await act(() => result.current.reload());
    expect(result.current.error).toBeNull();
  });

  it("drops an answer for folders it has left", async () => {
    let slow: (v: unknown) => void = () => undefined;
    api.webhooks.mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)));
    const { result, rerender } = renderHook(({ folders }) => useWebhooks(folders), { initialProps: { folders: ["/a"] } });
    api.webhooks.mockResolvedValueOnce({ hooks: [hook({ id: "new" })], signedIn: false });
    rerender({ folders: ["/b"] });
    await waitFor(() => expect(result.current.hooks[0]?.id).toBe("new"));
    act(() => slow({ hooks: [hook({ id: "old" })], signedIn: true }));
    await act(() => Promise.resolve());
    expect(result.current.hooks[0]?.id).toBe("new");
    expect(result.current.signedIn).toBe(false);
    // A failure that arrives late is dropped too.
    let late: (e: Error) => void = () => undefined;
    api.webhooks.mockImplementationOnce(() => new Promise((_, reject) => (late = reject)));
    act(() => {
      void result.current.reload();
    });
    api.webhooks.mockResolvedValueOnce({ hooks: [], signedIn: false });
    await act(() => result.current.reload());
    act(() => late(new Error("stale")));
    await act(() => Promise.resolve());
    expect(result.current.error).toBeNull();
  });

  it("polls only while active", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ active }) => useWebhooks(["/a"], active), { initialProps: { active: false } });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.webhooks).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    const before = api.webhooks.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.webhooks.mock.calls.length).toBe(before + 2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.webhooks.mock.calls.length).toBe(before + 2);
  });

  it("puts each call's answer in the list", async () => {
    const { result } = renderHook(() => useWebhooks(["/a"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const added = hook({ id: "w2", name: "resend" });
    api.addWebhook.mockResolvedValueOnce({ hook: added, existed: false });
    await act(async () => expect(await result.current.add({ folder: "/a", name: "resend", target: "/r" })).toEqual({ hook: added, existed: false }));
    expect(result.current.hooks.map((h) => h.id)).toEqual(["w1", "w2"]);
    api.updateWebhook.mockResolvedValueOnce({ hook: hook({ registered: true }) });
    await act(() => result.current.update("w1", { registered: true }));
    expect(api.updateWebhook).toHaveBeenCalledWith("w1", { registered: true });
    expect(result.current.hooks[0]?.registered).toBe(true);
    api.relayWebhook.mockResolvedValueOnce({ hook: hook({ url: "https://weft.zip/h/1" }) });
    await act(() => result.current.relay("w1"));
    expect(result.current.hooks[0]?.url).toBe("https://weft.zip/h/1");
    api.unrelayWebhook.mockResolvedValueOnce({ hook: hook() });
    await act(() => result.current.unrelay("w1"));
    expect(result.current.hooks[0]?.url).toBeUndefined();
    api.removeWebhook.mockResolvedValueOnce({ ok: true });
    await act(() => result.current.remove("w1"));
    expect(result.current.hooks.map((h) => h.id)).toEqual(["w2"]);
  });

  it("shows a change at once, before the server answers", async () => {
    const { result } = renderHook(() => useWebhooks(["/a"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The update hangs until the test lets it answer.
    let answer: (v: unknown) => void = () => undefined;
    api.updateWebhook.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    act(() => {
      void result.current.update("w1", { registered: true });
    });
    // The patch is in the list while the call is still waiting.
    expect(result.current.hooks[0]?.registered).toBe(true);
    await act(async () => {
      answer({ hook: hook({ registered: true }) });
      await Promise.resolve();
    });
    expect(result.current.hooks[0]?.registered).toBe(true);
  });

  it("reloads what the server has when a change is refused, and says why", async () => {
    const { result } = renderHook(() => useWebhooks(["/a"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(api.webhooks).toHaveBeenCalledTimes(1);
    api.updateWebhook.mockRejectedValueOnce(new Error("nope"));
    await act(() => expect(result.current.update("w1", { registered: true })).rejects.toThrow("nope"));
    // The refusal asks the server what it has, and the old row is back.
    await waitFor(() => expect(api.webhooks).toHaveBeenCalledTimes(2));
    expect(result.current.hooks[0]?.registered).toBeUndefined();
  });

  it("lets a failed call throw and leaves the list alone", async () => {
    const { result } = renderHook(() => useWebhooks(["/a"]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    api.removeWebhook.mockRejectedValueOnce(new Error("nope"));
    await act(() => expect(result.current.remove("w1")).rejects.toThrow("nope"));
    expect(result.current.hooks).toHaveLength(1);
  });
});

describe("addWebhookAsk / onWebhookAsk", () => {
  it("opens the drawer and serves the ask to a drawer that's there", () => {
    const open = vi.fn();
    const take = vi.fn(() => true);
    const off = onWebhookAsk(take);
    addWebhookAsk(open, { folder: "/a", id: "w1" });
    expect(open).toHaveBeenCalledWith("webhooks");
    expect(take).toHaveBeenCalledWith({ folder: "/a", id: "w1" });
    off();
  });

  it("holds the ask for a drawer that opens later, once", () => {
    addWebhookAsk(vi.fn(), { folder: "/a", id: "w2" });
    const take = vi.fn(() => true);
    const off = onWebhookAsk(take);
    expect(take).toHaveBeenCalledWith({ folder: "/a", id: "w2" });
    off();
    const again = vi.fn(() => true);
    onWebhookAsk(again)();
    expect(again).not.toHaveBeenCalled();
  });

  it("keeps the ask while the taker can't serve it, and forgets a taker that left", () => {
    const first = vi.fn(() => false);
    const off = onWebhookAsk(first);
    addWebhookAsk(vi.fn());
    off();
    const second = vi.fn(() => true);
    const offSecond = onWebhookAsk(second);
    expect(second).toHaveBeenCalledWith(undefined);
    // Leaving with a newer taker in place doesn't remove it.
    const third = vi.fn(() => true);
    const offThird = onWebhookAsk(third);
    offSecond();
    addWebhookAsk(vi.fn(), { folder: "/a", id: "w3" });
    expect(third).toHaveBeenCalledWith({ folder: "/a", id: "w3" });
    offThird();
  });
});

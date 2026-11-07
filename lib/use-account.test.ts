// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView } from "./types";

const api = vi.hoisted(() => ({
  account: vi.fn<() => Promise<AccountView>>(),
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth" })),
  magicLink: vi.fn(() => Promise.resolve({ ok: true })),
  signOut: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("./client", () => ({ api }));

const { ACCOUNT_EVENT, POLL_MS, WAIT_MS, announceAccountChange, useAccount } = await import("./use-account");

const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" };
const signedOut: AccountView = { configured: true, user: null };
const openExternal = vi.fn();

// Lets the promise callbacks queued by a fake-timer tick run.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.account.mockResolvedValue(signedOut);
  window.weft = { openExternal } as unknown as typeof window.weft;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAccount", () => {
  it("loads the view, or the error", async () => {
    const { result } = renderHook(() => useAccount());
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", view: signedOut }));

    api.account.mockRejectedValueOnce(new Error("down"));
    const failed = renderHook(() => useAccount());
    await waitFor(() => expect(failed.result.current.state).toEqual({ kind: "error", error: "down" }));
  });

  it("reloads when any instance announces a change, and stops listening on unmount", async () => {
    const { result, unmount } = renderHook(() => useAccount());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    api.account.mockResolvedValue({ configured: true, user: ada });
    act(() => announceAccountChange());
    await waitFor(() => expect(result.current.state).toEqual({ kind: "ready", view: { configured: true, user: ada } }));
    unmount();
    const calls = api.account.mock.calls.length;
    window.dispatchEvent(new Event(ACCOUNT_EVENT));
    expect(api.account).toHaveBeenCalledTimes(calls);
  });

  it("opens the provider in the system browser, polls, and announces the sign-in", async () => {
    vi.useFakeTimers();
    const heard = vi.fn();
    window.addEventListener(ACCOUNT_EVENT, heard);
    const { result } = renderHook(() => useAccount());
    await flush();
    await act(() => result.current.signIn("github"));
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/oauth");
    expect(result.current.waiting).toMatchObject({ what: "GitHub", email: false });

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(result.current.waiting).not.toBeNull();
    expect(heard).not.toHaveBeenCalled();

    api.account.mockResolvedValue({ configured: true, user: ada });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await flush();
    expect(result.current.waiting).toBeNull();
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(ACCOUNT_EVENT, heard);
  });

  it("falls back to window.open outside the desktop app", async () => {
    window.weft = undefined;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { result } = renderHook(() => useAccount());
    await act(() => result.current.signIn("github"));
    expect(open).toHaveBeenCalledWith("https://github.com/login/oauth", "_blank", "noopener,noreferrer");
    expect(result.current.waiting?.what).toBe("GitHub");
  });

  it("gives up waiting after a sign-in code would have expired", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAccount());
    await flush();
    await act(() => result.current.sendLink(" ada@b.co "));
    expect(api.magicLink).toHaveBeenCalledWith(" ada@b.co ");
    expect(result.current.waiting).toMatchObject({ what: "ada@b.co", email: true });
    await act(() => vi.advanceTimersByTimeAsync(WAIT_MS + POLL_MS));
    expect(result.current.waiting).toBeNull();
  });

  it("keeps waiting quietly when a poll fails", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAccount());
    await flush();
    await act(() => result.current.signIn("github"));
    api.account.mockRejectedValueOnce(new Error("blip"));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await flush();
    expect(result.current.waiting).not.toBeNull();
  });

  it("shows errors and clears busy", async () => {
    api.signIn.mockRejectedValueOnce(new Error("GitHub is off"));
    const { result } = renderHook(() => useAccount());
    await act(() => result.current.signIn("github"));
    expect(result.current.error).toBe("GitHub is off");
    expect(result.current.busy).toBeNull();
    api.signOut.mockRejectedValueOnce("offline");
    await act(() => result.current.signOut());
    expect(result.current.error).toBe("offline");
  });

  it("signs out and tells every instance", async () => {
    const heard = vi.fn();
    window.addEventListener(ACCOUNT_EVENT, heard);
    const { result } = renderHook(() => useAccount());
    await act(() => result.current.signOut());
    expect(api.signOut).toHaveBeenCalled();
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(ACCOUNT_EVENT, heard);
  });
});

// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Settings → Security's Keychain access card (lib/use-keychain-access.ts): the log from your Weft account, the
// lines waiting on the Mac and the grants, refreshed while the card is open.

const bridge = vi.hoisted(() => ({
  current: null as null | Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock("./vault-view", () => ({ vaultBridge: () => bridge.current }));
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const { useKeychainAccess } = await import("./use-keychain-access");

const RECORD = { signedIn: true, owner: "Alex", entries: [{ id: "a" }] };
const ACTIVITY = { entries: [{ id: "w" }], waiting: 1, syncedAt: null };
const GRANT = { card: "c1", id: "g1", label: "the weft vault", at: 0, until: 1 };

function respond(body: unknown, ok = true, status = 200) {
  apiFetch.mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.current = {
    activity: vi.fn(() => Promise.resolve(ACTIVITY)),
    grants: vi.fn(() => Promise.resolve([GRANT])),
    revoke: vi.fn(() => Promise.resolve({ revoked: 1 })),
  };
  respond(RECORD);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useKeychainAccess", () => {
  it("loads the account's log, the waiting lines and the grants", async () => {
    const { result } = renderHook(() => useKeychainAccess());
    await waitFor(() => expect(result.current.record).toEqual(RECORD));
    expect(apiFetch).toHaveBeenCalledWith("/api/account/keychain-events");
    expect(result.current.supported).toBe(true);
    expect(result.current.activity).toEqual(ACTIVITY);
    expect(result.current.grants).toEqual([GRANT]);
    expect(bridge.current?.activity).toHaveBeenCalledWith(500);
  });

  it("shows the account's error, or the status when there's none", async () => {
    respond({ error: "offline" }, false, 500);
    const { result } = renderHook(() => useKeychainAccess());
    await waitFor(() => expect(result.current.error).toBe("offline"));
    respond({}, false, 502);
    await act(() => result.current.reload());
    expect(result.current.error).toBe("HTTP 502");
  });

  it("keeps a thrown non-Error as text", async () => {
    bridge.current!.grants = vi.fn().mockRejectedValue("main is gone");
    const { result } = renderHook(() => useKeychainAccess());
    await waitFor(() => expect(result.current.error).toBe("main is gone"));
  });

  it("revokes a grant and loads again", async () => {
    const { result } = renderHook(() => useKeychainAccess());
    await waitFor(() => expect(result.current.record).toEqual(RECORD));
    await act(() => result.current.revoke(GRANT));
    expect(bridge.current?.revoke).toHaveBeenCalledWith("c1", "g1");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes while open", async () => {
    vi.useFakeTimers();
    renderHook(() => useKeychainAccess());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing outside the desktop app", async () => {
    bridge.current = null;
    const { result } = renderHook(() => useKeychainAccess());
    await act(() => result.current.reload());
    await act(() => result.current.revoke(GRANT));
    expect(result.current.supported).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

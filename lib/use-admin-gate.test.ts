// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSuperAdminGate } from "./use-admin-gate";

// The hook calls /api/admin/gate and listens for the weft:account window
// event. We mock the global fetch and exercise the three branches: the
// happy path, the gate's failure, and the account-change reload.
function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSuperAdminGate", () => {
  it("starts as false before the first fetch resolves", async () => {
    let resolveJson: (v: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveJson = (body) => resolve(new Response(JSON.stringify(body), { status: 200 })); }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSuperAdminGate());
    expect(result.current).toBe(false);
    await act(async () => {
      resolveJson({ admin: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("becomes true when the gate returns admin: true", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ admin: true }));
    const { result } = renderHook(() => useSuperAdminGate());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false when the gate returns admin: false", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ admin: false }));
    const { result } = renderHook(() => useSuperAdminGate());
    // Wait for the fetch promise chain to settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toBe(false);
  });


  it("stays false when the fetch throws (offline / 500)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { result } = renderHook(() => useSuperAdminGate());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toBe(false);
  });

  it("refetches when a weft:account event fires", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ admin: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ admin: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSuperAdminGate());
    await waitFor(() => expect(result.current).toBe(false));
    await act(async () => {
      window.dispatchEvent(new Event("weft:account"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the x-weft-token header with the request", async () => {
    const fetchMock = mockFetchOnce({ admin: true });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useSuperAdminGate());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [, init] = call as unknown as [string, RequestInit];
    const headers = init.headers;
    const token = headers instanceof Headers ? headers.get("x-weft-token") : (headers as Record<string, string>)["x-weft-token"];
    expect(token).toBe("1");
  });

  it("removes its weft:account listener on unmount", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({ admin: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useSuperAdminGate());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event("weft:account"));
      await Promise.resolve();
      await Promise.resolve();
    });
    // The unmounted hook should not have re-fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

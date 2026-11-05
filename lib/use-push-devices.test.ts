// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePushDevices } from "./use-push-devices";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const bad = (body: unknown, status = 502) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("usePushDevices", () => {
  it("reads the phones with the window's token", async () => {
    const fetch = vi.fn(() => Promise.resolve(ok({ signedIn: true, devices: [{ id: "d1" }] })));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => usePushDevices());
    await waitFor(() => expect(result.current.view).toEqual({ signedIn: true, devices: [{ id: "d1" }] }));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/push-devices");
    expect(new Headers(init.headers).get("x-weft-token")).toBe("1");
    expect(result.current.error).toBeNull();
  });

  it("shows the server's error, or the status when there's none", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(bad({ error: "down" }))));
    const first = renderHook(() => usePushDevices());
    await waitFor(() => expect(first.result.current.error).toBe("down"));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("not json", { status: 500 }))));
    const second = renderHook(() => usePushDevices());
    await waitFor(() => expect(second.result.current.error).toBe("HTTP 500"));
  });

  it("stringifies a thrown non-Error", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a thrown string, as some fetch shims do
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject("offline")));
    const { result } = renderHook(() => usePushDevices());
    await waitFor(() => expect(result.current.error).toBe("offline"));
  });

  it("removes a phone, then reads again", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "DELETE" ? ok({ ok: true }) : ok({ signedIn: true, devices: [] })));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => usePushDevices());
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await act(() => result.current.remove("a b"));
    expect(fetch.mock.calls[1]).toEqual(["/api/push-devices?id=a%20b", expect.objectContaining({ method: "DELETE" })]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws a failed remove to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve(init?.method === "DELETE" ? bad({ error: "nope" }) : ok({ signedIn: true, devices: [] }))));
    const { result } = renderHook(() => usePushDevices());
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await expect(result.current.remove("d1")).rejects.toThrow("nope");
  });
});

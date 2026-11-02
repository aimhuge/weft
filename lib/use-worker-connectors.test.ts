// @vitest-environment jsdom
// lib/use-worker-connectors.ts's edges; the toggles themselves are driven through components/WorkerConnectors.test.tsx.
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));
const { googleAccounts, useWorkerConnectors } = await import("./use-worker-connectors");

describe("useWorkerConnectors", () => {
  it("does nothing without main's bridge", async () => {
    const { result } = renderHook(() => useWorkerConnectors(undefined));
    expect(result.current.available).toBe(false);
    await act(() => result.current.toggle("w1", "m1mini", "gh"));
    expect(result.current.note).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("reads no Google accounts from a reply that isn't JSON, and says a refusal that isn't an Error", async () => {
    apiFetch.mockResolvedValue(new Response("<html>", { status: 200 }));
    const bridge = {
      list: vi.fn(() => Promise.resolve([])),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error refusal is the branch under test
    enable: vi.fn(() => Promise.reject("main is busy")), disable: vi.fn() };
    const { result } = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(bridge.list).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(result.current.google).toEqual([]);
    await act(() => result.current.toggle("w1", "m1mini", "gh"));
    expect(result.current.note).toBe("main is busy");
  });

  it("keeps going when the accounts can't be read, and drops a late answer after unmount", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    const bridge = { list: vi.fn(() => Promise.reject(new Error("main isn't up"))), enable: vi.fn(), disable: vi.fn() };
    const { result } = renderHook(() => useWorkerConnectors(bridge));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(result.current.google).toEqual([]);
    let answer: (r: Response) => void = () => undefined;
    apiFetch.mockReturnValueOnce(new Promise<Response>((done) => (answer = done)));
    const late = renderHook(() => useWorkerConnectors({ ...bridge, list: vi.fn(() => Promise.resolve([])) }));
    late.unmount();
    answer(new Response(JSON.stringify({ installed: true, accounts: [{ email: "a@b.co", client: "c" }] }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
  });

  it("reads gog's accounts, and none from a reply that isn't JSON", async () => {
    apiFetch.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await googleAccounts()).toEqual([]);
    apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ installed: true, accounts: [{ email: "a@b.co", client: "c" }] }), { status: 200 }));
    expect(await googleAccounts()).toEqual(["a@b.co"]);
  });
});

// @vitest-environment jsdom
// Your workers' projects, read once for Settings → Agents: the board read's list, or none when it can't be read.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch }));

const { useWorkerProjectsOnce } = await import("./use-worker-projects-once");
const project = { path: "worker://w1/site", workerId: "w1", worker: "m1mini", folder: "site", status: "online" };

beforeEach(() => apiFetch.mockReset());

describe("useWorkerProjectsOnce", () => {
  it("is the worker board's projects", async () => {
    apiFetch.mockResolvedValueOnce(Response.json({ projects: [project], cards: [] }));
    const { result } = renderHook(() => useWorkerProjectsOnce());
    await waitFor(() => expect(result.current).toEqual([project]));
    expect(apiFetch).toHaveBeenCalledWith("/api/worker-board");
  });

  it("is none when the read is refused, has no list, or fails", async () => {
    apiFetch.mockResolvedValueOnce(new Response("no", { status: 401 }));
    const refused = renderHook(() => useWorkerProjectsOnce());
    apiFetch.mockResolvedValueOnce(Response.json({}));
    const empty = renderHook(() => useWorkerProjectsOnce());
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    const failed = renderHook(() => useWorkerProjectsOnce());
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
    for (const r of [refused, empty, failed]) expect(r.result.current).toEqual([]);
  });

  it("drops a read that lands after the page closed", async () => {
    let land: (r: Response) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const { result, unmount } = renderHook(() => useWorkerProjectsOnce());
    unmount();
    land(Response.json({ projects: [project] }));
    await Promise.resolve();
    expect(result.current).toEqual([]);
  });
});

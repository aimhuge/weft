// @vitest-environment jsdom
// Where an in-thread ask_add puts its value (lib/use-ask-folder.ts): the ask's own folder on this Mac, and this Mac's
// checkout of a worker card's repo, looked up once per project.
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn<(url: string) => Promise<Response>>();
vi.mock("./api-client", () => ({ apiFetch: (url: string) => apiFetch(url) }));

const { AskProjectContext, askTwin, useAskFolder } = await import("./use-ask-folder");

const inProject = (project: string | null) =>
  function Wrap({ children }: { children: ReactNode }) {
    return <AskProjectContext.Provider value={project}>{children}</AskProjectContext.Provider>;
  };

afterEach(() => apiFetch.mockReset());

describe("askTwin", () => {
  it("asks the board's server for the twin, and is null when it has none or can't say", async () => {
    apiFetch.mockResolvedValueOnce(Response.json({ folder: "/dev/ling" }));
    expect(await askTwin("worker://w1/ling")).toBe("/dev/ling");
    expect(apiFetch).toHaveBeenCalledWith(`/api/worker-board?twin=${encodeURIComponent("worker://w1/ling")}`);
    apiFetch.mockResolvedValueOnce(Response.json({ folder: null }));
    expect(await askTwin("worker://w1/ling")).toBeNull();
    apiFetch.mockResolvedValueOnce(Response.json({ error: "no" }, { status: 500 }));
    expect(await askTwin("worker://w1/ling")).toBeNull();
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await askTwin("worker://w1/ling")).toBeNull();
  });
});

describe("useAskFolder", () => {
  it("is the ask's own folder on this Mac, with or without a context", () => {
    expect(renderHook(() => useAskFolder("/dev/web")).result.current).toBe("/dev/web");
    expect(renderHook(() => useAskFolder("/dev/web"), { wrapper: inProject("/dev/web") }).result.current).toBe("/dev/web");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("is this Mac's twin of a worker project once it's found, and undefined until then", async () => {
    apiFetch.mockResolvedValue(Response.json({ folder: "/dev/ling" }));
    const { result, unmount } = renderHook(() => useAskFolder("/home/worker/ling"), { wrapper: inProject("worker://w1/ling") });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe("/dev/ling"));
    unmount();
  });

  it("drops an answer that lands after it's gone", async () => {
    let land: (r: Response) => void = () => {};
    apiFetch.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const { result, unmount } = renderHook(() => useAskFolder("/home/worker/ling"), { wrapper: inProject("worker://w1/ling") });
    unmount();
    land(Response.json({ folder: "/dev/ling" }));
    await Promise.resolve();
    expect(result.current).toBeUndefined();
  });
});

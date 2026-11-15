// The real route and deps behind a synced folder's pipe (lib/line-tree-sync.ts treeSyncApi, realPipeDeps); the pipe
// itself is lib/line-tree-sync.test.ts.
import { describe, expect, it, vi } from "vitest";

const lines = vi.hoisted(() => ({ lineFor: vi.fn(), onLineFlips: vi.fn(), retainLine: vi.fn() }));
vi.mock("./session-lines", () => lines);
const client = vi.hoisted(() => ({ apiFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }));
vi.mock("./api-client", () => ({ apiFetch: client.apiFetch, API_HEADERS: { "x-weft-token": "1" } }));

const { realPipeDeps, treeSyncApi } = await import("./line-tree-sync");

describe("treeSyncApi", () => {
  it("posts to the route with the token, and answers its body", async () => {
    client.apiFetch.mockResolvedValueOnce(Response.json({ open: "x" }));
    expect(await treeSyncApi({ op: "open" })).toEqual({ open: "x" });
    expect(client.apiFetch).toHaveBeenCalledWith("/api/tree-sync", { method: "POST", headers: { "x-weft-token": "1" }, body: JSON.stringify({ op: "open" }) });
  });

  it("throws the route's error, or its status", async () => {
    client.apiFetch.mockResolvedValueOnce(Response.json({ error: "no" }, { status: 400 }));
    await expect(treeSyncApi({ op: "in" })).rejects.toThrow("no");
    client.apiFetch.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    await expect(treeSyncApi({ op: "in" })).rejects.toThrow("HTTP 500");
  });
});

describe("realPipeDeps", () => {
  it("is the route, the session lines and the console", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const deps = realPipeDeps();
    expect(deps.api).toBe(treeSyncApi);
    expect(deps.line).toBe(lines.lineFor);
    deps.log?.("hi");
    expect(info).toHaveBeenCalledWith("hi");
    info.mockRestore();
  });
});

// The header badges' reads on this Mac (lib/project-reads.ts): each from its own route, the field its answer holds it in.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());
vi.mock("./api-client", () => ({ apiFetch: (url: string) => fetchMock(url) }));

const { localRead } = await import("./project-reads");

beforeEach(() => fetchMock.mockReset());

describe("localRead", () => {
  it.each([
    ["quality", "/api/quality", { score: 80 }],
    ["scout", "/api/scout", { report: null, running: true }],
    ["pile", "/api/pile", { files: 2 }],
    ["backlog", "/api/sprint", { count: 3 }],
  ] as const)("reads %s from %s", async (name, route, value) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ [name]: value })));
    await expect(localRead(name, "/repo")).resolves.toEqual(value);
    expect(fetchMock).toHaveBeenCalledWith(`${route}?cwd=%2Frepo`);
  });

  it("is null when the route has nothing for the folder", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({})));
    await expect(localRead("pile", "/repo")).resolves.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { trashApi } from "./trash-client";

// The board's /api/trash calls carry x-weft-token (lib/api-client.ts) and throw the route's error.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("trashApi", () => {
  it("lists the trash with the token on", async () => {
    fetchMock.mockReturnValueOnce(answer({ items: [{ id: "a", title: "A", cwd: "/", deletedAt: 1 }] }));
    expect(await trashApi.list()).toEqual([{ id: "a", title: "A", cwd: "/", deletedAt: 1 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/trash");
    expect(new Headers(init?.headers).get("x-weft-token")).toBe("1");
  });

  it("restores by POST, escaping the id", async () => {
    fetchMock.mockReturnValueOnce(answer({ card: { id: "a b" } }));
    expect(await trashApi.restore("a b")).toEqual({ id: "a b" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/trash/a%20b");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("throws the route's error, or the status when the body has none", async () => {
    fetchMock.mockReturnValueOnce(answer({ error: "gone" }, 400));
    await expect(trashApi.restore("x")).rejects.toThrow("gone");
    fetchMock.mockReturnValueOnce(answer("not json", 500));
    await expect(trashApi.list()).rejects.toThrow("/api/trash answered 500");
  });
});

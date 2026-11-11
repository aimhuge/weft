import { beforeEach, describe, expect, it, vi } from "vitest";

// The Recently deleted API (app/api/trash): the list reads, Restore writes and needs x-weft-token.
const listTrash = vi.hoisted(() => vi.fn(() => [{ id: "a", title: "A", cwd: "/", deletedAt: 1 }]));
const restoreFromTrash = vi.hoisted(() => vi.fn((id: string) => ({ id, column: "review" })));
vi.mock("@/lib/card-trash", () => ({ listTrash, restoreFromTrash }));

const route = await import("./trash/route");
const idRoute = await import("./trash/[id]/route");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1" };
const req = (url: string, method: string, headers: Record<string, string>) => new Request(`http://localhost:3457/api${url}`, { method, headers });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("GET /api/trash", () => {
  it("lists the deleted cards", async () => {
    const res = route.GET(req("/trash", "GET", READ));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ id: "a", title: "A", cwd: "/", deletedAt: 1 }] });
  });

  it("refuses another host", () => {
    expect(route.GET(req("/trash", "GET", { host: "evil.com" })).status).toBe(403);
    expect(listTrash).not.toHaveBeenCalled();
  });
});

describe("POST /api/trash/[id]", () => {
  it("restores the card", async () => {
    const res = await idRoute.POST(req("/trash/a", "POST", WRITE), ctx("a"));
    expect(await res.json()).toEqual({ card: { id: "a", column: "review" } });
    expect(restoreFromTrash).toHaveBeenCalledWith("a");
  });

  it("needs the token", async () => {
    expect((await idRoute.POST(req("/trash/a", "POST", READ), ctx("a"))).status).toBe(403);
    expect(restoreFromTrash).not.toHaveBeenCalled();
  });

  it("answers 400 with the reason when it can't", async () => {
    restoreFromTrash.mockImplementationOnce(() => {
      throw new Error("That card isn't in Recently deleted any more.");
    });
    const res = await idRoute.POST(req("/trash/x", "POST", WRITE), ctx("x"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That card isn't in Recently deleted any more." });
  });
});

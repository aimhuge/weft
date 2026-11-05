// Your teammates' cards on the desktop board (app/api/team-board/route.ts): GET lists them, or reads a page of one's
// thread or a cut tool output in the team's workspace. Read-only: there is no POST. lib/team-board.test.ts covers the rows.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const guard = vi.hoisted(() => ({ denied: null as Response | null }));
vi.mock("@/lib/guard", () => ({ guard: () => guard.denied, fail: (err: Error, status = 400) => Response.json({ error: err.message }, { status }) }));
const board = vi.hoisted(() => ({
  readTeamBoard: vi.fn((): Promise<unknown> => Promise.resolve({ signedIn: true, cards: [] })),
  teamThreadPage: vi.fn((): Promise<unknown> => Promise.resolve({ items: [], start: 0, total: 0 })),
  teamToolOutput: vi.fn(() => Promise.resolve("all of it")),
}));
vi.mock("@/lib/team-board", () => board);

const route = await import("./route");
const ORG = "0b5c7a4e-1111-4222-8333-944445555666";
const get = (query = "") => route.GET(new Request(`http://localhost/api/team-board${query}`));

beforeEach(() => {
  guard.denied = null;
  vi.clearAllMocks();
});

describe("GET /api/team-board", () => {
  it("is refused without the token", async () => {
    guard.denied = new Response("no", { status: 403 });
    expect((await get()).status).toBe(403);
  });

  it("lists the cards, since a date when given", async () => {
    expect(await (await get()).json()).toEqual({ signedIn: true, cards: [] });
    expect(board.readTeamBoard).toHaveBeenLastCalledWith(undefined, undefined);
    await get("?since=2026-11-05T06:00:00.000Z");
    expect(board.readTeamBoard).toHaveBeenLastCalledWith(undefined, "2026-11-05T06:00:00.000Z");
    await get("?since=later");
    expect(board.readTeamBoard).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("needs the card's workspace to read its thread", async () => {
    expect((await get("?card=c1")).status).toBe(400);
    expect((await get("?card=c1&org=nope")).status).toBe(400);
  });

  it("reads a page, walking back or forward", async () => {
    expect((await get(`?card=c1&org=${ORG}&before=20`)).status).toBe(200);
    expect(board.teamThreadPage).toHaveBeenLastCalledWith(ORG, "c1", 20, undefined);
    await get(`?card=c1&org=${ORG}&after=7`);
    expect(board.teamThreadPage).toHaveBeenLastCalledWith(ORG, "c1", undefined, 7);
    await get(`?card=c1&org=${ORG}&after=x`);
    expect(board.teamThreadPage).toHaveBeenLastCalledWith(ORG, "c1", undefined, undefined);
  });

  it("says so when the thread can't be read", async () => {
    board.teamThreadPage.mockResolvedValueOnce(null);
    expect((await get(`?card=c1&org=${ORG}`)).status).toBe(502);
  });

  it("reads a cut tool output", async () => {
    expect(await (await get(`?card=c1&org=${ORG}&tool=t9`)).json()).toEqual({ result: "all of it" });
    expect(board.teamToolOutput).toHaveBeenCalledWith(ORG, "c1", "t9");
  });

  it("fails a read that throws", async () => {
    board.readTeamBoard.mockRejectedValueOnce(new Error("down"));
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "down" });
  });
});

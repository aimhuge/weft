import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));
// lib/show-dir.ts reads DATA_DIR from the store, which these tests mock.
vi.mock("@/lib/show-dir", () => ({ SHOW_DIR: "/weft/show" }));
// The guard reads the launch token; none here, so every check no-ops.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("@/lib/store", () => ({
  listCards: vi.fn(() => [
    { id: "a", title: "Card A", prompt: "Do A", cwd: "/dev/app", column: "backlog", createdAt: 0 },
    { id: "b", title: "Card B", prompt: "Do B", cwd: "/dev/app/web", column: "backlog", createdAt: 1 },
    { id: "r", title: "Card R", prompt: "", cwd: "/dev/app", column: "running", createdAt: 0 },
  ]),
}));
vi.mock("@/lib/commit-pile", async (load) => ({
  ...(await load<typeof import("@/lib/commit-pile")>()),
  repoRoot: vi.fn(() => "/dev/app"),
}));

const pile = await import("@/lib/commit-pile");
const store = await import("@/lib/store");
const URL_BASE = "http://localhost:3457/api/sprint";
const READ = { host: "localhost:3457" };
const get = (query = "", headers = READ) => GET(new Request(`${URL_BASE}${query}`, { headers }));
type Body = { backlog: unknown; prompt?: string; title?: string };
const json = async (res: Response) => (await res.json()) as Body;

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sprint", () => {
  it("refuses a foreign host", async () => {
    expect((await get("?cwd=/dev/app", { host: "evil.com" })).status).toBe(403);
  });

  it("is null without ?cwd=", async () => {
    expect(await json(await get())).toEqual({ backlog: null });
    expect(pile.repoRoot).not.toHaveBeenCalled();
  });

  it("counts the repo's Backlog cards and the ones at work", async () => {
    expect(await json(await get("?cwd=%2Fdev%2Fapp%2Fweb"))).toEqual({ backlog: { root: "/dev/app", count: 2, active: 1 } });
    expect(pile.repoRoot).toHaveBeenCalledWith("/dev/app/web");
  });

  it("uses the folder itself outside a repo, and is null when its Backlog is empty", async () => {
    vi.mocked(pile.repoRoot).mockImplementationOnce(() => {
      throw new Error("not a git repository");
    });
    expect(await json(await get("?cwd=/dev/app/web"))).toEqual({ backlog: { root: "/dev/app/web", count: 1, active: 0 } });
    expect(await json(await get("?cwd=/dev/app&prompt=1"))).toMatchObject({ title: "Plan the app backlog into sprints" });
    vi.mocked(store.listCards).mockReturnValueOnce([]);
    expect(await json(await get("?cwd=/dev/app"))).toEqual({ backlog: null });
  });

  it("with &prompt=1, adds the planning prompt and title", async () => {
    const body = await json(await get("?cwd=/dev/app&prompt=1"));
    expect(body.title).toBe("Plan the app backlog into sprints");
    expect(body.prompt).toContain('1. "Card A" (card a,');
    expect(body.prompt).toContain('2. "Card B" (card b,');
    expect(body.prompt).toContain("http://localhost:3457/api/cards/<card id>");
  });

  it("500s when reading the board fails", async () => {
    vi.mocked(store.listCards).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    expect((await get("?cwd=/x")).status).toBe(500);
  });
});

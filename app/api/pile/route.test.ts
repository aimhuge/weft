import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/skills", () => ({ PLUGIN_DIR: "/weft/plugin" }));
// lib/show-dir.ts reads DATA_DIR from the store, which these tests mock.
vi.mock("@/lib/show-dir", () => ({ SHOW_DIR: "/weft/show" }));
// The guard reads the launch token; none here, so every check no-ops.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("@/lib/store", () => ({
  listCards: vi.fn(() => [
    { id: "a", title: "Card A", cwd: "/dev/app", column: "review", touchedFiles: ["/dev/app/a.ts"] },
    { id: "b", title: "Card B", cwd: "/dev/app", column: "review", touchedFiles: [] },
  ]),
}));
vi.mock("@/lib/commit-pile", async (load) => ({
  ...(await load<typeof import("@/lib/commit-pile")>()),
  readPile: vi.fn(() => ({ root: "/dev/app", files: [{ path: "a.ts", code: " M" }, { path: "x.ts", code: "??" }], added: 5, removed: 2 })),
}));

const pile = await import("@/lib/commit-pile");
const URL_BASE = "http://localhost:3457/api/pile";
const READ = { host: "localhost:3457" };
const get = (query = "", headers = READ) => GET(new Request(`${URL_BASE}${query}`, { headers }));
type Body = { pile: unknown; prompt?: string; title?: string };
const json = async (res: Response) => (await res.json()) as Body;

beforeEach(() => vi.clearAllMocks());

describe("GET /api/pile", () => {
  it("refuses a foreign host", async () => {
    const res = await get("?cwd=/dev/app", { host: "evil.com" });
    expect(res.status).toBe(403);
    expect(pile.readPile).not.toHaveBeenCalled();
  });

  it("is null without ?cwd=", async () => {
    expect(await json(await get())).toEqual({ pile: null });
    expect(pile.readPile).not.toHaveBeenCalled();
  });

  it("is null for a clean tree or no repo", async () => {
    vi.mocked(pile.readPile).mockReturnValueOnce(null);
    expect(await json(await get("?cwd=/dev/app"))).toEqual({ pile: null });
  });

  it("sums the pile and counts the Review cards it belongs to", async () => {
    const body = await json(await get("?cwd=%2Fdev%2Fapp"));
    expect(body).toEqual({ pile: { root: "/dev/app", files: 2, added: 5, removed: 2, cards: 1 } });
    expect(pile.readPile).toHaveBeenCalledWith("/dev/app");
  });

  it("with &prompt=1, adds the walk-through prompt and title", async () => {
    const body = await json(await get("?cwd=/dev/app&prompt=1"));
    expect(body.title).toBe("Commit the uncommitted pile in app");
    expect(body.prompt).toContain("bash /weft/plugin/skills/done/commit.sh");
    expect(body.prompt).toContain("http://localhost:3457/api/cards/<card id>");
    expect(body.prompt).toContain('"Card A" (card a)');
    expect(body.prompt).toContain("- x.ts (new)");
  });

  it("500s when reading fails", async () => {
    vi.mocked(pile.readPile).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    expect((await get("?cwd=/x")).status).toBe(500);
  });
});

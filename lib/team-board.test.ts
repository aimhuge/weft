import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const teamOrgsFor = vi.hoisted(() => vi.fn());
const threadPageIn = vi.hoisted(() => vi.fn());
const toolOutputIn = vi.hoisted(() => vi.fn());
const marks = vi.hoisted(() => ({ takeoversOf: vi.fn() }));
const side = vi.hoisted(() => ({ readSide: vi.fn(), applySide: vi.fn(), sideUsers: vi.fn(), handoverStates: vi.fn() }));
const repos = new Map<string, string>();

vi.mock("./account", () => ({ accountClient: () => ({ default: true, auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }) }));
vi.mock("./cloud-sync-route", () => ({ teamOrgsFor }));
vi.mock("./cloud-thread-read", () => ({ threadPageIn, toolOutputIn }));
vi.mock("./repos", () => ({ githubRepoOf: (folder: string) => repos.get(folder) }));
vi.mock("./settings", () => ({ listProjects: () => [{ path: "/dev/exiting" }, { path: "/dev/exiting-2" }, { path: "/tmp/plain" }] }));
vi.mock("./team-takeover-marks", () => marks);
vi.mock("./team-board-side", () => side);
vi.mock("./worker-board-open", () => ({ openCardRows: (_org: string, rows: unknown[]) => Promise.resolve(rows) }));

import { forgetRepoFolders, readTeamBoard, repoFolders, teamCard, teamThreadPage, teamToolOutput, TEAM_CARD_LIMIT } from "./team-board";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// A Supabase query builder: records each filter, answers what `answer` gives for the table and filters.
function client(uid: string | null, answer: (table: string, calls: [string, ...unknown[]][]) => Result) {
  const seen: { table: string; calls: [string, ...unknown[]][] }[] = [];
  const builder = (table: string) => {
    const calls: [string, ...unknown[]][] = [];
    seen.push({ table, calls });
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "neq", "gt", "order", "limit"]) b[m] = (...args: unknown[]) => (calls.push([m, ...args]), b);
    b.then = (ok: (r: Result) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(answer(table, calls)).then(ok, bad);
    return b;
  };
  return {
    seen,
    c: { auth: { getSession: () => Promise.resolve({ data: { session: uid ? { user: { id: uid } } : null } }) }, from: builder } as never,
  };
}

const row = (id: string, over: Partial<{ owner_user: string; repo: string; card: Partial<Card>; deleted: boolean; updated_at: string }> = {}) => ({
  card_id: id,
  owner_user: "zulker",
  owner_device: "dev-z",
  repo: "exitingcom/exitingcom",
  updated_at: "2026-11-05T06:00:00.000Z",
  deleted: false,
  ...over,
  card: { id, title: id, cwd: "/Users/zulker/code/exiting", column: "running", ...over.card },
});

const profiles = { data: [{ id: "zulker", display_name: "Zulker Nayeen", avatar_url: "https://a/z.png" }], error: null };

beforeEach(() => {
  forgetRepoFolders();
  repos.clear();
  repos.set("/dev/exiting", "Exitingcom/exitingcom");
  repos.set("/dev/exiting-2", "exitingcom/exitingcom");
  teamOrgsFor.mockReset().mockResolvedValue(new Map([["exitingcom/exitingcom", "org-x"]]));
  marks.takeoversOf.mockReset().mockResolvedValue(new Map());
  side.readSide.mockReset().mockResolvedValue({ taken: [], asks: [], mine: [] });
  side.applySide.mockReset();
  side.sideUsers.mockReset().mockReturnValue([]);
  side.handoverStates.mockReset().mockReturnValue(new Map());
});

describe("repoFolders", () => {
  it("maps each repo to the most recently used folder, and keeps the table a minute", () => {
    const map = repoFolders(1000);
    expect([...map]).toEqual([["exitingcom/exitingcom", "/dev/exiting"]]);
    repos.set("/tmp/plain", "a/b");
    expect(repoFolders(2000)).toBe(map);
    expect(repoFolders(1000 + 60_000).get("a/b")).toBe("/tmp/plain");
  });

  it("reads listProjects by default", () => {
    expect(repoFolders(5, () => [{ path: "/tmp/plain" } as never]).size).toBe(0);
  });
});

describe("readTeamBoard", () => {
  it("is signed out without a session", async () => {
    const { c } = client(null, () => ({ data: [], error: null }));
    expect(await readTeamBoard(c)).toEqual({ signedIn: false, cards: [] });
  });

  it("reads nothing with no project on GitHub", async () => {
    const { c, seen } = client("me", () => ({ data: [], error: null }));
    expect(await readTeamBoard(c, undefined, 0, () => new Map())).toEqual({ signedIn: true, cards: [] });
    expect(seen).toHaveLength(0);
    expect(teamOrgsFor).not.toHaveBeenCalled();
  });

  it("files teammates' cards under this Mac's folder for the repo, marked with whose they are", async () => {
    const { c, seen } = client("me", (table) =>
      table === "profiles" ? profiles : { data: [row("z1"), row("z2", { owner_user: "michael", updated_at: "2026-11-05T07:00:00.000Z" }), row("pilot", { card: { role: "copilot" } })], error: null },
    );
    const board = await readTeamBoard(c, undefined, 0);
    expect(board.signedIn).toBe(true);
    expect(board.asOf).toBe("2026-11-05T07:00:00.000Z");
    expect(board.delta).toBeUndefined();
    expect(board.cards.map((x) => [x.id, x.cwd, x.team])).toEqual([
      ["z1", "/dev/exiting", { org: "org-x", owner: "zulker", name: "Zulker Nayeen", avatar: "https://a/z.png", device: "dev-z" }],
      ["z2", "/dev/exiting", { org: "org-x", owner: "michael", name: "A teammate", avatar: null, device: "dev-z" }],
    ]);
    const cards = seen.find((s) => s.table === "cloud_cards")!.calls;
    expect(cards).toContainEqual(["eq", "org_id", "org-x"]);
    expect(cards).toContainEqual(["in", "repo", ["exitingcom/exitingcom"]]);
    expect(cards).toContainEqual(["neq", "owner_user", "me"]);
    expect(cards).toContainEqual(["eq", "deleted", false]);
    expect(cards).toContainEqual(["limit", TEAM_CARD_LIMIT]);
  });

  it("asks nothing of cloud_cards when no team linked the repos", async () => {
    teamOrgsFor.mockResolvedValue(new Map([["exitingcom/exitingcom", null]]));
    const { c, seen } = client("me", () => ({ data: [], error: null }));
    expect(await readTeamBoard(c, undefined, 0)).toEqual({ signedIn: true, cards: [] });
    expect(seen.map((s) => s.table)).toEqual([]);
  });

  it("reads only what changed since, with the deleted and the copilot as removed", async () => {
    const { c, seen } = client("me", (table) =>
      table === "profiles" ? { data: null, error: null } : { data: [row("z1"), row("gone", { deleted: true }), row("pilot", { card: { role: "copilot" } })], error: null },
    );
    const board = await readTeamBoard(c, "2026-11-05T06:00:10.000Z", 0);
    expect(board.delta).toBe(true);
    expect(board.removed).toEqual(["gone", "pilot"]);
    expect(board.cards.map((x) => x.id)).toEqual(["z1"]);
    const cards = seen.find((s) => s.table === "cloud_cards")!.calls;
    expect(cards).toContainEqual(["gt", "updated_at", "2026-11-05T06:00:08.000Z"]);
  });

  it("keeps since as asOf when nothing changed", async () => {
    const { c } = client("me", () => ({ data: [], error: null }));
    const board = await readTeamBoard(c, "2026-11-05T06:00:10.000Z", 0);
    expect(board).toEqual({ signedIn: true, cards: [], asOf: "2026-11-05T06:00:10.000Z", delta: true, removed: [] });
  });

  it("ignores a since that isn't a date, and rows without a stamp", async () => {
    const { c } = client("me", (table) => (table === "profiles" ? profiles : { data: [{ ...row("z1"), updated_at: undefined }], error: null }));
    const board = await readTeamBoard(c, "soon", 0);
    expect(board.asOf).toBeUndefined();
    expect(board.delta).toBeUndefined();
  });

  it("sends a changed read that fills the limit whole", async () => {
    const rows = Array.from({ length: TEAM_CARD_LIMIT }, (_, i) => row(`c${i}`));
    const { c } = client("me", (table) => (table === "profiles" ? profiles : { data: rows, error: null }));
    const board = await readTeamBoard(c, "2026-11-05T06:00:10.000Z", 0);
    expect(board.delta).toBeUndefined();
    expect(board.cards).toHaveLength(TEAM_CARD_LIMIT);
  });

  it("leaves out a row for a repo this Mac hasn't", async () => {
    const { c } = client("me", (table) => (table === "profiles" ? profiles : { data: [row("x", { repo: "other/repo" })], error: null }));
    expect((await readTeamBoard(c, undefined, 0)).cards).toEqual([]);
  });

  it("shows nothing on a database without the repo column yet", async () => {
    for (const code of ["42703", "PGRST204"]) {
      const { c } = client("me", () => ({ data: null, error: { code, message: "column cloud_cards.repo does not exist" } }));
      expect((await readTeamBoard(c, undefined, 0)).cards).toEqual([]);
    }
  });

  it("throws any other error", async () => {
    const { c } = client("me", () => ({ data: null, error: { code: "42501", message: "denied" } }));
    await expect(readTeamBoard(c, undefined, 0)).rejects.toThrow("Couldn't read your team's threads: denied");
  });

  it("reads as the account by default", async () => {
    await expect(readTeamBoard()).resolves.toEqual({ signedIn: false, cards: [] });
  });
});

describe("teamCard", () => {
  it("names a teammate without a profile", () => {
    const card = teamCard(row("z") as never, "org-x", "/dev/exiting", { id: "zulker", display_name: "  ", avatar_url: null });
    expect(card.team?.name).toBe("A teammate");
  });
});

describe("the thread", () => {
  it("reads a page and a tool output in the card's team workspace", async () => {
    threadPageIn.mockResolvedValue({ items: [], start: 0, total: 0 });
    toolOutputIn.mockResolvedValue("out");
    expect(await teamThreadPage("org-x", "z1", 10, undefined)).toEqual({ items: [], start: 0, total: 0 });
    expect(threadPageIn).toHaveBeenCalledWith(expect.objectContaining({ default: true }), "org-x", "z1", 10, undefined);
    expect(await teamToolOutput("org-x", "z1", "t1")).toBe("out");
    expect(toolOutputIn).toHaveBeenCalledWith(expect.objectContaining({ default: true }), "org-x", "z1", "t1");
  });
});

describe("readTeamBoard with takeovers", () => {
  const taken = (card: string, by: string) => ({ org_id: "org-x", card_id: card, by_user: by, at: "2026-11-05T08:00:00.000Z" });
  const twoProfiles = { data: [...profiles.data, { id: "alex", display_name: "Alex Miller", avatar_url: null }], error: null };

  it("marks a card a teammate took over with who took it", async () => {
    marks.takeoversOf.mockResolvedValue(new Map([["z1", taken("z1", "alex")]]));
    const { c } = client("me", (table) => (table === "profiles" ? twoProfiles : { data: [row("z1"), row("z2")], error: null }));
    const board = await readTeamBoard(c, undefined, 0);
    expect(marks.takeoversOf).toHaveBeenCalledWith(c, "org-x");
    expect(board.cards.find((x) => x.id === "z1")?.team?.takenOver).toEqual({ name: "Alex Miller", at: "2026-11-05T08:00:00.000Z" });
    expect(board.cards.find((x) => x.id === "z2")?.team?.takenOver).toBeUndefined();
  });

  it("leaves off a card you took over, and says it's gone on a changed read", async () => {
    marks.takeoversOf.mockResolvedValue(new Map([["z1", taken("z1", "me")]]));
    const { c } = client("me", (table) => (table === "profiles" ? profiles : { data: [row("z1"), row("z2")], error: null }));
    const board = await readTeamBoard(c, "2026-11-05T05:00:00.000Z", 0);
    expect(board.cards.map((x) => x.id)).toEqual(["z2"]);
    expect(board.removed).toEqual(["z1"]);
  });

  it("reads and applies the side, names its users, and draws your ask on its card", async () => {
    const sideRead = { taken: [], asks: [], mine: [] };
    side.readSide.mockResolvedValue(sideRead);
    side.sideUsers.mockReturnValue(["alex"]);
    side.handoverStates.mockReturnValue(new Map([["z1", { id: "h1", status: "asked" }]]));
    const { c, seen } = client("me", (table) => (table === "profiles" ? twoProfiles : { data: [row("z1"), row("z2")], error: null }));
    const board = await readTeamBoard(c, undefined, 5);
    expect(side.readSide).toHaveBeenCalledWith(c, "me", ["org-x"], 5);
    expect(seen.find((q) => q.table === "profiles")?.calls).toContainEqual(["in", "id", ["zulker", "alex"]]);
    const [read, orgs, name, passed] = side.applySide.mock.calls[0] as [unknown, string[], (u: string) => string, unknown];
    expect([read, orgs, passed]).toEqual([sideRead, ["org-x"], c]);
    expect(name("alex")).toBe("Alex Miller");
    expect(name("nobody")).toBe("A teammate");
    expect(board.cards.find((x) => x.id === "z1")?.team?.handover).toEqual({ id: "h1", status: "asked" });
    expect(board.cards.find((x) => x.id === "z2")?.team?.handover).toBeUndefined();
  });
});

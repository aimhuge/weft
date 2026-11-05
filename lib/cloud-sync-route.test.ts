import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxEntry } from "./cloud-sync-types";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const repos = new Map<string, string>();

vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));
vi.mock("./repos", () => ({ githubRepoOf: (folder: string) => repos.get(folder) }));

type Rpc = (fn: string, args: { repos: string[] }) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

function client(linked: Record<string, string> = {}, rpc?: Rpc) {
  const calls: string[][] = [];
  const answer: Rpc =
    rpc ??
    ((_fn, args) =>
      Promise.resolve({
        data: args.repos.filter((r) => linked[r.toLowerCase()]).map((r) => ({ repo: r, org_id: linked[r.toLowerCase()] })),
        error: null,
      }));
  return {
    calls,
    client: {
      rpc: (fn: string, args: { repos: string[] }) => (calls.push(args.repos), answer(fn, args)),
    } as never,
  };
}

const card = (id: string, cwd: string) => cards.set(id, { id, cwd } as Card);
const entry = (cardId: string, op: OutboxEntry["op"] = "card"): OutboxEntry => ({ op, cardId, at: 0 }) as OutboxEntry;

let route: typeof import("./cloud-sync-route");

beforeEach(async () => {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftSyncRoutes;
  cards.clear();
  repos.clear();
  route = await import("./cloud-sync-route");
});

describe("routeFor", () => {
  it("sends a linked project's cards to its team and the rest home", async () => {
    repos.set("/dev/exiting", "Exitingcom/exitingcom");
    repos.set("/dev/urkis", "zulker/urkis");
    card("a", "/dev/exiting");
    card("b", "/dev/urkis");
    card("c", "/tmp/no-git");
    const { client: c, calls } = client({ "exitingcom/exitingcom": "team" });
    const r = await route.routeFor(c, "home", [entry("a"), entry("b"), entry("c")], 0);
    expect([r.orgOf("a"), r.orgOf("b"), r.orgOf("c")]).toEqual(["team", "home", "home"]);
    expect(calls).toEqual([["exitingcom/exitingcom", "zulker/urkis"]]);
    expect(r.all().sort()).toEqual(["home", "team"]);
  });

  it("asks nothing when no card has a GitHub repo", async () => {
    card("a", "/tmp/x");
    const { client: c, calls } = client();
    const r = await route.routeFor(c, "home", [entry("a"), entry("gone", "card_deleted")], 0);
    expect(calls).toEqual([]);
    expect(r.orgOf("a")).toBe("home");
    expect(r.all()).toEqual(["home"]);
  });

  it("remembers where a card went, so its delete looks there after it's gone", async () => {
    repos.set("/dev/exiting", "o/exiting");
    card("a", "/dev/exiting");
    const { client: c } = client({ "o/exiting": "team" });
    await route.routeFor(c, "home", [entry("a")], 0);
    cards.delete("a");
    const r = await route.routeFor(c, "home", [entry("a", "card_deleted")], 1);
    expect(r.all().sort()).toEqual(["home", "team"]);
  });
});

describe("teamOrgsFor", () => {
  it("keeps an answer for a minute, then asks again", async () => {
    const { client: c, calls } = client({ "o/r": "team" });
    expect((await route.teamOrgsFor(c, ["O/R"], 0)).get("o/r")).toBe("team");
    await route.teamOrgsFor(c, ["o/r"], route.ROUTE_TTL_MS - 1);
    expect(calls).toHaveLength(1);
    await route.teamOrgsFor(c, ["o/r"], route.ROUTE_TTL_MS);
    expect(calls).toHaveLength(2);
  });

  it("asks again after forgetRoutes", async () => {
    const { client: c, calls } = client();
    await route.teamOrgsFor(c, ["o/r"], 0);
    route.forgetRoutes();
    await route.teamOrgsFor(c, ["o/r"], 1);
    expect(calls).toHaveLength(2);
  });

  it("routes home when the database hasn't the function yet", async () => {
    const { client: c } = client({}, () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }));
    expect((await route.teamOrgsFor(c, ["o/r"], 0)).get("o/r")).toBeNull();
    const { client: d } = client({}, () => Promise.resolve({ data: null, error: { message: "function public.team_orgs_for_repos(text[]) does not exist" } }));
    route.forgetRoutes();
    expect((await route.teamOrgsFor(d, ["o/r"], 0)).get("o/r")).toBeNull();
  });

  it("throws on any other error, so a team's card never lands at home", async () => {
    const { client: c } = client({}, () => Promise.resolve({ data: null, error: { message: "timeout" } }));
    await expect(route.teamOrgsFor(c, ["o/r"], 0)).rejects.toThrow("Couldn't read the team projects: timeout");
  });

  it("treats an empty answer as no team", async () => {
    const { client: c } = client({}, () => Promise.resolve({ data: null, error: null }));
    expect((await route.teamOrgsFor(c, ["o/r"], 0)).get("o/r")).toBeNull();
  });
});

describe("orgForFolder", () => {
  it("is the repo's team, or home", async () => {
    repos.set("/dev/exiting", "o/exiting");
    const { client: c } = client({ "o/exiting": "team" });
    expect(await route.orgForFolder(c, "home", "/dev/exiting", 0)).toBe("team");
    expect(await route.orgForFolder(c, "home", "/tmp/none", 0)).toBe("home");
    repos.set("/dev/other", "o/other");
    expect(await route.orgForFolder(c, "home", "/dev/other")).toBe("home");
  });
});

describe("byOrg and singleRoute", () => {
  it("groups entries by workspace in order", () => {
    const r = route.singleRoute("o1");
    expect(r.all()).toEqual(["o1"]);
    const split = { home: "h", orgOf: (id: string) => (id.startsWith("t") ? "t" : "h"), all: () => ["h", "t"] };
    const groups = route.byOrg([{ cardId: "t1" }, { cardId: "h1" }, { cardId: "t2" }], split);
    expect([...groups]).toEqual([
      ["t", [{ cardId: "t1" }, { cardId: "t2" }]],
      ["h", [{ cardId: "h1" }]],
    ]);
    expect([...route.byOrg([{ cardId: "x" }], r)]).toEqual([["o1", [{ cardId: "x" }]]]);
  });
});

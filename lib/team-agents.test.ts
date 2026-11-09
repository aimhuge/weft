import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Team agents (lib/team-agents.ts): pulling your teams and their agents from Supabase into ~/.weft/team-agents.json,
// sharing and unsharing one of yours, pushing your shared copies after a save, and the timers that keep it all current.

const h = await vi.hoisted(async () => (await import("./team-agents.harness")).teamAgentsState());

vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
  listCards: () => [],
  updateCard: () => {},
}));

vi.mock("./account", async () => (await import("./team-agents.harness")).accountMock(h));

const store = await import("./agent-store");
const cache = await import("./team-agent-cache");
const team = await import("./team-agents");

const cacheFile = () => path.join(h.dir, "team-agents.json");
const reviewer = { name: "Reviewer", emoji: "🔍", tagline: "Reviews code", soul: "You review." };
const ops = (name: string) => h.calls.filter((c) => c[0] === name);
const pulls = () => h.calls.filter((c) => c[0] === "from" && c[1] === "org_memberships").length;

const acme = { id: "org-1111aaaa", name: "Acme" };
// A teammate's agent's words, as a team_agents row and the cache both carry them.
const helper = { name: "Helper", emoji: "🧰", tagline: "Helps", soul: "You help." };
// A team_agents row as Supabase sends it.
const row = (over: Record<string, unknown> = {}) => ({ org_id: acme.id, agent_id: "a-12345678", ...helper, skills_off: ["x"], created_by: "other", ...over });

// The cache as a pull would have left it, written straight to disk.
function seedCache(next: { me: string | null; teams?: { id: string; name: string }[]; rows?: unknown[] }) {
  fs.writeFileSync(cacheFile(), JSON.stringify({ teams: [], rows: [], ...next }));
  cache.forgetTeamCache();
}

beforeEach(() => {
  h.fromThrows = false;
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-team-agents-"));
  h.me = "me";
  h.accountThrows = false;
  h.res = {
    memberships: { data: [{ org_id: acme.id, orgs: acme }], error: null },
    agents: { data: [], error: null },
    update: { data: [], error: null },
    insert: { error: null },
    delete: { error: null },
  };
  h.calls = [];
  store.forgetAgents();
  cache.forgetTeamCache();
  team.forgetTeamPull();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pulling your teams' agents", () => {
  it("leaves an empty cache alone when you're signed out, and clears one that had someone in it", async () => {
    h.me = null;
    expect(await team.pullTeamAgents()).toBe(false);
    expect(fs.existsSync(cacheFile())).toBe(false);
    seedCache({ me: "me", teams: [acme] });
    expect(await team.pullTeamAgents()).toBe(false);
    expect(cache.readTeamCache()).toEqual({ me: null, teams: [], rows: [] });
    expect(JSON.parse(fs.readFileSync(cacheFile(), "utf8"))).toEqual({ me: null, teams: [], rows: [] });
  });

  it("gives up quietly when accounts aren't set up in this build", async () => {
    h.accountThrows = true;
    expect(await team.pullTeamAgents()).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("keeps the last copy when the sign-in itself can't be read, as offline, without throwing", async () => {
    seedCache({ me: "me", teams: [{ id: "o", name: "Kept" }] });
    h.me = "reject";
    expect(await team.pullTeamAgents()).toBe(false);
    expect(cache.readTeamCache().teams).toEqual([{ id: "o", name: "Kept" }]);
  });

  it("keeps the last copy when your teams can't be read", async () => {
    seedCache({ me: "me", teams: [{ id: "o", name: "Kept" }] });
    h.res.memberships = { data: null, error: { message: "offline" } };
    expect(await team.pullTeamAgents()).toBe(false);
    expect(cache.readTeamCache().teams).toEqual([{ id: "o", name: "Kept" }]);
  });

  it("asks for your memberships and every team agent, and keeps each with its team's name", async () => {
    h.res.memberships = { data: [{ org_id: acme.id, orgs: acme }, { org_id: "org-gone", orgs: null }], error: null };
    h.res.agents = { data: [row(), row({ org_id: "org-elsewhere", agent_id: "a-2", skills_off: null, created_by: "me" })], error: null };
    expect(await team.pullTeamAgents()).toBe(true);
    expect(ops("select")).toEqual([
      ["select", "org_memberships", "org_id, orgs(id, name, org_memberships(count))"],
      ["select", "team_agents", "org_id, agent_id, name, emoji, tagline, soul, skills_off, created_by"],
    ]);
    expect(ops("eq")).toEqual([["eq", "user_id", "me"]]);
    expect(cache.readTeamCache()).toEqual({
      me: "me",
      teams: [acme],
      rows: [
        { orgId: acme.id, orgName: "Acme", agentId: "a-12345678", ...helper, skillsOff: ["x"], createdBy: "other" },
        { orgId: "org-elsewhere", orgName: "Your team", agentId: "a-2", ...helper, skillsOff: [], createdBy: "me" },
      ],
    });
  });

  it("leaves a workspace of one out of the teams to share with, unless one of yours is already there", async () => {
    const solo = (id: string, count: number) => ({ org_id: id, orgs: { id, name: id, org_memberships: [{ count }] } });
    h.res.memberships = { data: [solo("o-team", 3), solo("o-me", 1), solo("o-mine-left", 1)], error: null };
    h.res.agents = { data: [row({ org_id: "o-mine-left", created_by: "me" })], error: null };
    await team.pullTeamAgents();
    expect(cache.readTeamCache().teams).toEqual([
      { id: "o-team", name: "o-team" },
      { id: "o-mine-left", name: "o-mine-left" },
    ]);
  });

  it.each(["PGRST205", "42P01"])("writes your teams with no agents when the server has no team_agents table (%s)", async (code) => {
    h.res.agents = { data: null, error: { code, message: "missing" } };
    expect(await team.pullTeamAgents()).toBe(true);
    expect(cache.readTeamCache()).toEqual({ me: "me", teams: [acme], rows: [] });
  });

  it("keeps the last copy when team agents fail for any other reason", async () => {
    seedCache({ me: "me", teams: [{ id: "o", name: "Kept" }] });
    h.res.agents = { data: null, error: { code: "500", message: "boom" } };
    expect(await team.pullTeamAgents()).toBe(false);
    expect(cache.readTeamCache().teams).toEqual([{ id: "o", name: "Kept" }]);
  });
});

describe("pulling soon", () => {
  it("pulls at most once a minute", async () => {
    team.syncTeamAgentsSoon(100_000);
    team.syncTeamAgentsSoon(159_999);
    await vi.waitFor(() => expect(cache.readTeamCache().me).toBe("me"));
    expect(pulls()).toBe(1);
    team.syncTeamAgentsSoon(160_000);
    await vi.waitFor(() => expect(pulls()).toBe(2));
  });

  it("never throws when the pull rejects", async () => {
    h.me = "me";
    h.fromThrows = true;
    expect(() => team.syncTeamAgentsSoon(100_000)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pulls()).toBe(0);
  });
});

describe("sharing an agent with a team", () => {
  it("refuses an agent that doesn't exist", async () => {
    await expect(team.shareAgent("a-none", "org-1")).rejects.toThrow("No such agent.");
  });

  it("refuses a built-in, which every Weft already has", async () => {
    await expect(team.shareAgent("builder", "org-1")).rejects.toThrow("Duplicate it to share");
  });

  it("refuses a team's agent, which is its sharer's", async () => {
    seedCache({ me: "me", teams: [{ id: "org-1111aaaa", name: "Acme" }], rows: [{ orgId: "org-1111aaaa", orgName: "Acme", agentId: "a-1", name: "Helper", emoji: "🧰", tagline: "", soul: "s", skillsOff: [], createdBy: "other" }] });
    await expect(team.shareAgent(cache.teamAgentId("org-1111aaaa", "a-1"), "org-2")).rejects.toThrow("Helper is already Acme's.");
  });

  it("asks you to sign in first", async () => {
    const mine = store.createAgent(reviewer);
    h.me = null;
    await expect(team.shareAgent(mine.id, "org-1")).rejects.toThrow("Sign in to Weft to share agents with a team.");
  });

  it("inserts the agent's words and skills for a team that has no copy yet, then pulls", async () => {
    const mine = store.createAgent({ ...reviewer, skillsOff: ["web"] });
    const plain = store.createAgent({ ...reviewer, name: "Plain" });
    await team.shareAgent(mine.id, "org-1");
    await team.shareAgent(plain.id, "org-1");
    const words = { name: "Reviewer", emoji: "🔍", tagline: "Reviews code", soul: "You review." };
    expect(ops("insert")).toEqual([
      ["insert", "team_agents", { org_id: "org-1", agent_id: mine.id, ...words, skills_off: ["web"] }],
      ["insert", "team_agents", { org_id: "org-1", agent_id: plain.id, ...words, name: "Plain", skills_off: [] }],
    ]);
    expect(pulls()).toBe(2);
  });

  // An upsert would set org_id and agent_id too, which team_agents' column grants refuse (docs/bug-fixes/020).
  it("never upserts: it updates only the words of a copy already there, and inserts nothing", async () => {
    const mine = store.createAgent(reviewer);
    h.res.update = { data: [{ agent_id: mine.id }], error: null };
    await team.shareAgent(mine.id, "org-1");
    expect(ops("update")).toEqual([["update", "team_agents", { name: "Reviewer", emoji: "🔍", tagline: "Reviews code", soul: "You review.", skills_off: [] }]]);
    expect(ops("eq").slice(0, 2)).toEqual([
      ["eq", "org_id", "org-1"],
      ["eq", "agent_id", mine.id],
    ]);
    expect(ops("insert")).toEqual([]);
    expect(ops("upsert")).toEqual([]);
  });

  it("names the agent when the update itself fails, without trying an insert", async () => {
    const mine = store.createAgent(reviewer);
    h.res.update = { error: { code: "42501", message: "denied" } };
    await expect(team.shareAgent(mine.id, "org-1")).rejects.toThrow("Couldn't share Reviewer: denied");
    expect(ops("insert")).toEqual([]);
  });

  it("says when the server has no team agents yet", async () => {
    const mine = store.createAgent(reviewer);
    h.res.update = { error: { code: "PGRST205", message: "missing" } };
    await expect(team.shareAgent(mine.id, "org-1")).rejects.toThrow("Team agents aren't set up on Weft's server yet.");
    expect(pulls()).toBe(0);
  });

  it("names the agent and the server's reason when the share fails", async () => {
    const mine = store.createAgent(reviewer);
    h.res.insert = { error: { code: "42501", message: "denied" } };
    await expect(team.shareAgent(mine.id, "org-1")).rejects.toThrow("Couldn't share Reviewer: denied");
  });
});

describe("unsharing an agent", () => {
  it("asks you to sign in first", async () => {
    h.me = null;
    await expect(team.unshareAgent("a-1", "org-1")).rejects.toThrow("Sign in to Weft");
  });

  it("deletes that team's copy by team and agent, then pulls", async () => {
    await team.unshareAgent("a-1", "org-1");
    expect(ops("delete")).toEqual([["delete", "team_agents"]]);
    expect(ops("eq").slice(0, 2)).toEqual([
      ["eq", "org_id", "org-1"],
      ["eq", "agent_id", "a-1"],
    ]);
    expect(pulls()).toBe(1);
  });

  it("says why when it can't stop sharing", async () => {
    h.res.delete = { error: { message: "denied" } };
    await expect(team.unshareAgent("a-1", "org-1")).rejects.toThrow("Couldn't stop sharing: denied");
    expect(pulls()).toBe(0);
  });
});

describe("pushing your shared copies", () => {
  const shareRow = (agentId: string, orgId: string) => ({ orgId, orgName: "Acme", agentId, name: "X", emoji: "", tagline: "", soul: "s", skillsOff: [], createdBy: "me" });

  it("does nothing when you share nothing", async () => {
    seedCache({ me: "me", rows: [{ ...shareRow("a-1", "org-1"), createdBy: "other" }] });
    await team.pushMyShares();
    expect(h.calls).toEqual([]);
  });

  it("does nothing when you're signed out", async () => {
    seedCache({ me: "me", rows: [shareRow("a-1", "org-1")] });
    h.me = null;
    await team.pushMyShares();
    expect(h.calls).toEqual([]);
  });

  it("updates an agent still saved in each team it's shared with, deletes one that's gone, then pulls", async () => {
    const mine = store.createAgent(reviewer);
    seedCache({ me: "me", rows: [shareRow(mine.id, "org-1"), shareRow(mine.id, "org-2"), shareRow("a-gone", "org-1"), shareRow("a-gone", "org-3")] });
    h.res.update = { data: [{ agent_id: mine.id }], error: null };
    await team.pushMyShares();
    const words = { name: "Reviewer", emoji: "🔍", tagline: "Reviews code", soul: "You review.", skills_off: [] };
    expect(ops("update")).toEqual([
      ["update", "team_agents", words],
      ["update", "team_agents", words],
    ]);
    expect(ops("eq").slice(0, 4)).toEqual([
      ["eq", "org_id", "org-1"],
      ["eq", "agent_id", mine.id],
      ["eq", "org_id", "org-2"],
      ["eq", "agent_id", mine.id],
    ]);
    expect(ops("insert")).toEqual([]);
    expect(ops("delete")).toEqual([["delete", "team_agents"]]);
    expect(ops("eq")[4]).toEqual(["eq", "agent_id", "a-gone"]);
    expect(ops("in")).toEqual([["in", "org_id", ["org-1", "org-3"]]]);
    expect(pulls()).toBe(1);
  });

  it("warns about each copy it couldn't update and still finishes with a pull", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mine = store.createAgent(reviewer);
    seedCache({ me: "me", rows: [shareRow(mine.id, "org-1"), shareRow("a-gone", "org-1")] });
    h.res.update = { error: { message: "denied" } };
    h.res.delete = { error: { message: "gone away" } };
    await team.pushMyShares();
    expect(warn.mock.calls).toEqual([["Team agents: couldn't update Reviewer: denied"], ["Team agents: couldn't update a-gone: gone away"]]);
    expect(pulls()).toBe(1);
  });
});

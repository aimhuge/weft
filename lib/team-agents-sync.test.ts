import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Team agents' timers (lib/team-agents.ts startTeamAgentsSync): the pull at start and every ten minutes, the push after
// a burst of saves, and a failed push tried again on the next tick. The rest of team agents is in team-agents.test.ts.

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

describe("keeping team agents in sync", () => {
  // The pull keeps one share of yours (a deleted agent), so every push deletes its copy.
  beforeEach(() => {
    vi.useFakeTimers();
    h.res.agents = { data: [row({ agent_id: "a-gone", created_by: "me" })], error: null };
  });

  it("pulls at once and every ten minutes", async () => {
    const stop = team.startTeamAgentsSync();
    await vi.advanceTimersByTimeAsync(1);
    expect(pulls()).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pulls()).toBe(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pulls()).toBe(3);
    stop();
  });

  it("pushes your shares once, 1.5 s after a burst of saves settles", async () => {
    const stop = team.startTeamAgentsSync();
    await vi.advanceTimersByTimeAsync(1);
    store.createAgent(reviewer);
    await vi.advanceTimersByTimeAsync(1000);
    store.createAgent({ ...reviewer, name: "Second" });
    await vi.advanceTimersByTimeAsync(1499);
    expect(ops("delete")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ops("delete")).toHaveLength(1);
    expect(ops("in")).toEqual([["in", "org_id", ["org-1111aaaa"]]]);
    stop();
  });

  it("pushes again on the next ten-minute tick after a push failed, and only pulls once it went through", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = team.startTeamAgentsSync();
    await vi.advanceTimersByTimeAsync(1);
    h.res.delete = { error: { message: "offline" } };
    store.createAgent(reviewer);
    await vi.advanceTimersByTimeAsync(1500);
    expect(ops("delete")).toHaveLength(1);
    h.res.delete = { error: null };
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ops("delete")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(ops("delete")).toHaveLength(2);
    stop();
  });

  it("stops the timer, the waiting push and the listener", async () => {
    const stop = team.startTeamAgentsSync();
    await vi.advanceTimersByTimeAsync(1);
    store.createAgent(reviewer);
    stop();
    await vi.advanceTimersByTimeAsync(2000);
    store.createAgent({ ...reviewer, name: "Second" });
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(ops("delete")).toEqual([]);
    expect(pulls()).toBe(1);
  });

  it("swallows a failed pull or push on the timers", async () => {
    // One of yours is shared, so the push after a save reaches the database too.
    seedCache({ me: "me", teams: [acme], rows: [{ orgId: acme.id, orgName: "Acme", agentId: "a-mine", ...helper, skillsOff: [], createdBy: "me" }] });
    const stop = team.startTeamAgentsSync();
    await vi.advanceTimersByTimeAsync(1);
    h.fromThrows = true;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    store.createAgent(reviewer);
    await vi.advanceTimersByTimeAsync(1500);
    expect(pulls()).toBe(1);
    expect(ops("delete")).toEqual([]);
    stop();
  });
});

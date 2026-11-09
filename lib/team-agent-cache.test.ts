import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The last copy of your teams' agents (lib/team-agent-cache.ts), in ~/.weft/team-agents.json: what the pickers and the
// prompt read when there's no network, which of them are yours, and the fingerprint that tells idle threads to restart.

const h = vi.hoisted(() => ({ dir: "" }));
vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
}));

const cache = await import("./team-agent-cache");
const row = (over: Partial<import("./team-agent-cache").TeamAgentRow> = {}) => ({
  orgId: "0123456789abcdef", orgName: "Acme", agentId: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review.", skillsOff: [], createdBy: "them", ...over,
});

beforeEach(() => {
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-team-agents-"));
  cache.forgetTeamCache();
});

describe("the team agents cache", () => {
  it("is empty with no file, a broken one or one of the wrong shape", () => {
    expect(cache.readTeamCache()).toEqual({ me: null, teams: [], rows: [] });
    fs.writeFileSync(path.join(h.dir, "team-agents.json"), "{ nope");
    cache.forgetTeamCache();
    expect(cache.teamAgents()).toEqual([]);
    fs.writeFileSync(path.join(h.dir, "team-agents.json"), JSON.stringify({ me: 3, teams: {}, rows: "x" }));
    cache.forgetTeamCache();
    expect(cache.readTeamCache()).toEqual({ me: null, teams: [], rows: [] });
    expect(cache.teamCacheHash()).toBe("");
  });

  it("keeps what it's given on disk", () => {
    cache.writeTeamCache({ me: "me", teams: [{ id: "org-1", name: "Acme" }], rows: [row()] });
    cache.forgetTeamCache();
    expect(cache.readTeamCache().teams).toEqual([{ id: "org-1", name: "Acme" }]);
    expect(cache.teamCacheHash()).toMatch(/^[0-9a-f]{12}$/);
  });

  it("offers everyone's agents but your own, each with its team, under an id no other team shares", () => {
    cache.writeTeamCache({ me: "me", teams: [], rows: [row(), row({ agentId: "a-2", createdBy: "me" }), row({ orgId: "fedcba9876543210", skillsOff: ["tdac"] })] });
    const agents = cache.teamAgents();
    expect(agents.map((a) => a.id)).toEqual(["t-01234567-a-1", "t-fedcba98-a-1"]);
    expect(agents[0]).toEqual({ id: "t-01234567-a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review.", team: { id: "0123456789abcdef", name: "Acme" } });
    expect(agents[1]!.skillsOff).toEqual(["tdac"]);
    expect(cache.teamAgentId("0123456789abcdef", "a-9")).toBe("t-01234567-a-9");
  });

  it("names the teams each of yours is shared with, and none when nobody's signed in", () => {
    cache.writeTeamCache({ me: "me", teams: [], rows: [row({ createdBy: "me" }), row({ orgId: "org-2", createdBy: "me" }), row({ agentId: "a-3" })] });
    expect(cache.myShares()).toEqual({ "a-1": ["0123456789abcdef", "org-2"] });
    cache.writeTeamCache({ me: null, teams: [], rows: [row({ createdBy: "me" })] });
    expect(cache.myShares()).toEqual({});
  });
});

// Your agents on a Weft Worker (lib/agent-sync.ts): what this host sends, capped, and what a worker takes, each agent and
// default checked on its own. The store is the real one on a temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dir: "" }));
vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
  listCards: () => [],
  updateCard: vi.fn(),
}));

const store = await import("./agent-store");
const { agentsSnapshot, applyAgentsSnapshot, readAgentsSnapshot, SNAPSHOT_MAX_CHARS } = await import("./agent-sync");

const agent = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Agent ${id}`, emoji: "🤖", tagline: "", soul: "You work.", ...over });

beforeEach(() => {
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-agent-sync-"));
  store.forgetAgents();
});

const save = (agents: unknown[], projects: Record<string, string> = {}) => {
  fs.writeFileSync(path.join(h.dir, "agents.json"), JSON.stringify({ agents, projects }));
  store.forgetAgents();
};

describe("agentsSnapshot", () => {
  it("sends your agents in one shape and only the worker projects' defaults", () => {
    save([{ ...agent("a-1"), builtIn: true, changed: "you", skillsOff: ["ship"], extra: 1 }, { ...agent("a-2"), name: "x".repeat(41) }], { "/dev/app": "a-1", "worker://w-1/weft": "a-1" });
    expect(agentsSnapshot()).toEqual({
      saved: [{ id: "a-1", name: "Agent a-1", emoji: "🤖", tagline: "", soul: "You work.", skillsOff: ["ship"], changed: "you" }],
      projects: { "worker://w-1/weft": "a-1" },
    });
  });

  it("stops at the size cap, so the account row isn't refused", () => {
    const big = "x".repeat(SNAPSHOT_MAX_CHARS / 2);
    save([agent("a-1", { soul: big.slice(0, 20_000) }), ...Array.from({ length: 20 }, (_, i) => agent(`a-${i + 2}`, { soul: big.slice(0, 19_000) }))]);
    const sent = agentsSnapshot().saved;
    expect(sent.length).toBeLessThan(21);
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS + 2_000);
  });
});

describe("readAgentsSnapshot", () => {
  it("takes the agents and defaults that check out, each on its own", () => {
    const read = readAgentsSnapshot({
      saved: [agent("a-1"), agent("../x"), agent("a-2", { soul: " " }), agent("a-3", { name: "" }), agent("a-4", { emoji: undefined, tagline: undefined, skillsOff: [1], changed: "them" }), "nope"],
      projects: { "worker://w-1/weft": "a-1", "/etc": "a-1", "worker://w-1/app": "../x", "worker://w-1/num": 3 },
    });
    expect(read).toEqual({
      saved: [agent("a-1"), { id: "a-4", name: "Agent a-4", emoji: "", tagline: "", soul: "You work." }],
      projects: { "worker://w-1/weft": "a-1" },
    });
  });

  it("is nothing when it isn't a snapshot", () => {
    expect(readAgentsSnapshot(null)).toBeUndefined();
    expect(readAgentsSnapshot({ saved: {}, projects: {} })).toBeUndefined();
    expect(readAgentsSnapshot({ saved: [], projects: [] })).toBeUndefined();
  });
});

describe("applyAgentsSnapshot", () => {
  it("puts your Mac's agents and defaults in this host's store", () => {
    applyAgentsSnapshot({ saved: [agent("a-mac")], projects: { "worker://w-1/weft": "a-mac" } });
    expect(store.listAgents().some((a) => a.id === "a-mac")).toBe(true);
    expect(store.projectAgent("worker://w-1/weft")).toBe("a-mac");
  });
});

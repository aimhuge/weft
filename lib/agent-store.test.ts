import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_AGENTS, WEFT_SOUL_PROMPT } from "./agents";

// Settings → Agents' store (lib/agent-store.ts): your agents and built-in edits in ~/.weft/agents.json, each project's
// default, an agent's skills, and Reset pulling a built-in's latest text from GitHub.

const h = vi.hoisted(() => ({ dir: "", cards: [] as { id: string; agent?: string }[], updated: [] as unknown[] }));

vi.mock("./store", () => ({
  get DATA_DIR() {
    return h.dir;
  },
  listCards: () => h.cards,
  updateCard: (id: string, patch: unknown) => h.updated.push([id, patch]),
}));
vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  threadPrompt: () => "",
  subagentModel: () => "choose",
}));

const store = await import("./agent-store");
const reviewer = { name: "Reviewer", emoji: "🔍", tagline: "Reviews  code", soul: "You review." };
const file = () => path.join(h.dir, "agents.json");

beforeEach(() => {
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-agents-"));
  h.cards = [];
  h.updated = [];
  store.forgetAgents();
});

afterEach(() => vi.unstubAllGlobals());

describe("making and editing agents", () => {
  it("lists the built-ins when nothing is saved, and reads a broken file as nothing", () => {
    expect(store.listAgents()).toEqual(BUILT_IN_AGENTS);
    expect(store.savedAgentsHash()).toBe("");
    fs.writeFileSync(file(), "{ nope");
    store.forgetAgents();
    expect(store.listAgents()).toEqual(BUILT_IN_AGENTS);
    fs.writeFileSync(file(), JSON.stringify({ agents: { no: 1 }, projects: null }));
    store.forgetAgents();
    expect(store.listAgents()).toEqual(BUILT_IN_AGENTS);
    expect(store.projectAgents()).toEqual({});
    fs.writeFileSync(file(), JSON.stringify({ agents: [{ id: "a-x" }, null, { id: "a-1", name: "Kept", soul: "s" }] }));
    store.forgetAgents();
    expect(store.listAgents().map((a) => a.name)).toEqual(["Builder", "Copywriter", "Kept"]);
  });

  it("adds one of yours after the built-ins, with an id of its own, and keeps it on disk", () => {
    const made = store.createAgent(reviewer);
    expect(made).toMatchObject({ name: "Reviewer", tagline: "Reviews code", soul: "You review." });
    expect(made.id).toMatch(/^a-[0-9a-f]{8}$/);
    store.forgetAgents();
    expect(store.listAgents().map((a) => a.name)).toEqual(["Builder", "Copywriter", "Reviewer"]);
    expect(store.savedAgentsHash()).toMatch(/^[0-9a-f]{12}$/);
  });

  it("gives an agent with no emoji a robot, and refuses no name, no soul, a soul too long or a name taken", () => {
    expect(store.createAgent({ ...reviewer, emoji: "" }).emoji).toBe("🤖");
    expect(() => store.createAgent({ ...reviewer, name: " " })).toThrow("needs a name");
    expect(() => store.createAgent({ ...reviewer, name: "Other", soul: "" })).toThrow("needs a soul");
    expect(() => store.createAgent({ ...reviewer, name: "Other", soul: 3 })).toThrow("needs a soul");
    expect(() => store.createAgent({ ...reviewer, name: "Other", soul: "x".repeat(20001) })).toThrow("at most 20,000");
    expect(() => store.createAgent({ ...reviewer, name: "builder" })).toThrow("already an agent called Builder");
  });

  it("edits a built-in by saving over it, and one of yours in place", () => {
    const edited = store.updateAgent("builder", { name: "Builder", emoji: "🛠", tagline: "Mine", soul: "My soul." });
    expect(edited).toMatchObject({ builtIn: true, changed: "you", soul: "My soul." });
    const mine = store.createAgent(reviewer);
    expect(store.updateAgent(mine.id, { ...reviewer, soul: "Stricter." }).soul).toBe("Stricter.");
    expect(store.listAgents()).toHaveLength(3);
    expect(() => store.updateAgent("a-none", reviewer)).toThrow("No such agent.");
  });

  it("deletes only yours, sends its cards back to Builder and clears it as a project's default", () => {
    const mine = store.createAgent(reviewer);
    h.cards = [{ id: "c1", agent: mine.id }, { id: "c2", agent: "copywriter" }];
    store.setProjectAgent("/dev/app", mine.id);
    store.deleteAgent(mine.id);
    expect(store.listAgents()).toHaveLength(2);
    expect(h.updated).toEqual([["c1", { agent: undefined }]]);
    expect(store.projectAgents()).toEqual({});
    expect(() => store.deleteAgent("copywriter")).toThrow("built in: reset it instead");
  });
});

describe("each project's default", () => {
  it("names the agent a folder's new threads start as, never a deleted or unknown one", () => {
    store.setProjectAgent("/dev/app", "copywriter");
    expect(store.projectAgent("/dev/app")).toBe("copywriter");
    expect(store.projectAgent("/dev/other")).toBeUndefined();
    fs.writeFileSync(file(), JSON.stringify({ agents: [], projects: { "/dev/app": "a-gone" } }));
    store.forgetAgents();
    expect(store.projectAgent("/dev/app")).toBeUndefined();
  });

  it("clears with Builder or null, and refuses an unknown agent or no folder", () => {
    store.setProjectAgent("/dev/app", "copywriter");
    store.setProjectAgent("/dev/app", "builder");
    expect(store.projectAgents()).toEqual({});
    store.setProjectAgent("/dev/app", "copywriter");
    store.setProjectAgent("/dev/app", null);
    expect(store.projectAgents()).toEqual({});
    expect(() => store.setProjectAgent("/dev/app", "a-none")).toThrow("No such agent.");
    expect(() => store.setProjectAgent("", "copywriter")).toThrow("Which project?");
  });
});

describe("an agent's skills", () => {
  it("turns skills off and on for every thread with it, and an edit of its words keeps them", async () => {
    store.setAgentSkill("copywriter", "tdac", false);
    store.setAgentSkill("copywriter", "posthog@posthog", false);
    store.setAgentSkill("copywriter", "posthog@posthog", true);
    expect(store.agentSkillsOff("copywriter")).toEqual(["tdac"]);
    expect(store.listAgents()[1]!.changed).toBeUndefined();
    store.updateAgent("copywriter", { ...reviewer, name: "Copywriter" });
    expect(store.agentSkillsOff("copywriter")).toEqual(["tdac"]);
    expect(store.agentSkillsOff(undefined)).toEqual([]);
    const { offFor } = await import("./skill-sets");
    expect(offFor({ cwd: "/dev/app", agent: "copywriter", skillsOff: ["x"] })).toEqual(["tdac", "x"]);
    expect(offFor({ cwd: "/dev/app", agent: "copywriter", skillsOn: ["tdac"] })).toEqual([]);
  });

  it("keeps only real skill names, each once", () => {
    const made = store.createAgent({ ...reviewer, skillsOff: ["a", "a", "b c", 3, "x@y"] });
    expect(made.skillsOff).toEqual(["a", "x@y"]);
  });
});

describe("resetting a built-in", () => {
  const github = (agents: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(agents) })));

  it("takes GitHub's newer text, marked as GitHub's", async () => {
    store.updateAgent("copywriter", { ...reviewer, name: "Copywriter" });
    github([{ id: "copywriter", name: "Copywriter", emoji: "✍️", tagline: "Newer", soul: "The newest soul." }]);
    const { agent, from } = await store.resetAgent("copywriter");
    expect(from).toBe("github");
    expect(agent).toMatchObject({ soul: "The newest soul.", changed: "github", builtIn: true });
    expect(fetch).toHaveBeenCalledWith(store.BUILT_IN_URL, expect.anything());
  });

  it("goes back to the shipped text when GitHub has the same, keeping the skills you picked", async () => {
    store.updateAgent("builder", { name: "Builder", emoji: "🛠", soul: "Mine." });
    store.setAgentSkill("builder", "tdac", false);
    github(BUILT_IN_AGENTS);
    const { agent } = await store.resetAgent("builder");
    expect(agent).toMatchObject({ soul: WEFT_SOUL_PROMPT, changed: undefined, skillsOff: ["tdac"] });
  });

  it("falls back to the shipped text when GitHub can't be reached or lacks it, and drops the edit", async () => {
    store.updateAgent("builder", { name: "Builder", emoji: "🛠", soul: "Mine." });
    github([], false);
    expect(await store.resetAgent("builder")).toMatchObject({ from: "shipped", agent: { soul: WEFT_SOUL_PROMPT } });
    expect((JSON.parse(fs.readFileSync(file(), "utf8")) as { agents: unknown[] }).agents).toEqual([]);
    github([{ id: "builder" }]);
    expect((await store.resetAgent("builder")).from).toBe("shipped");
    github({ not: "a list" });
    expect((await store.resetAgent("builder")).from).toBe("shipped");
  });

  it("fills in the emoji and line when GitHub's copy leaves them out", async () => {
    github([{ id: "copywriter", name: "Copywriter", soul: "Bare." }]);
    expect((await store.resetAgent("copywriter")).agent).toMatchObject({ emoji: "✍️", tagline: "", soul: "Bare." });
  });

  it("refuses one you made", async () => {
    const mine = store.createAgent(reviewer);
    await expect(store.resetAgent(mine.id)).rejects.toThrow("Only a built-in agent resets");
  });
});

describe("the prompt", () => {
  it("opens with a saved agent's soul, and a change to any saved agent changes the build", async () => {
    const { promptsBuild, weftSystemPrompt } = await import("./weft-prompts");
    const before = promptsBuild();
    const mine = store.createAgent(reviewer);
    expect(promptsBuild()).not.toBe(before);
    expect(weftSystemPrompt({ backend: "claude", agent: mine.id }).startsWith("You review.")).toBe(true);
  });
});

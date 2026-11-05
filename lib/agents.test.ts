import { beforeEach, describe, expect, it, vi } from "vitest";
import BUILT_IN from "./agents-built-in.json";
import { AGENT_SOULS, agentOf, BUILT_IN_AGENTS, COPYWRITER_SOUL_PROMPT, findAgent, isAgent, isBuiltIn, mergeAgents, shippedAgent, storedAgent, WEFT_SOUL_PROMPT, type AgentInfo } from "./agents";

// Who a thread is (docs/architecture/agents.md): its soul opens the system prompt. The built-ins ship in
// lib/agents-built-in.json; the ones you made or edited come in as a list (lib/agent-store.ts).

vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  threadPrompt: () => "",
  subagentModel: () => "choose",
}));

const reviewer: AgentInfo = { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review." };
const builder = BUILT_IN_AGENTS[0]!;

describe("the built-ins", () => {
  it("are Builder and Copywriter, from the JSON GitHub serves for Reset", () => {
    expect(BUILT_IN_AGENTS.map((a) => a.id)).toEqual(["builder", "copywriter"]);
    expect(BUILT_IN_AGENTS.map((a) => a.soul)).toEqual(BUILT_IN.map((a) => a.soul));
    expect(BUILT_IN_AGENTS.every((a) => a.builtIn)).toBe(true);
    expect(builder.soul).toBe(WEFT_SOUL_PROMPT);
    expect(isBuiltIn("copywriter")).toBe(true);
    expect(isBuiltIn("a-1")).toBe(false);
    expect(shippedAgent("copywriter").soul).toBe(COPYWRITER_SOUL_PROMPT);
    expect(() => shippedAgent("poet")).toThrow('lib/agents-built-in.json has no "poet" agent.');
  });

  it("the copywriter writes in Weft's voice and still reads the project's own instructions", () => {
    for (const rule of ["your AI", "Weft is the subject", "No plumbing", "commit, push, deploy", "mcp__board__changelog_add", "SOUL.md"]) {
      expect(COPYWRITER_SOUL_PROMPT, rule).toContain(rule);
    }
  });

  it("every shipped soul counts toward the prompt fingerprint", () => {
    for (const a of BUILT_IN_AGENTS) expect(AGENT_SOULS).toContain(a.soul);
  });
});

describe("mergeAgents", () => {
  it("is the built-ins as shipped when nothing is saved", () => {
    expect(mergeAgents()).toEqual(BUILT_IN_AGENTS);
  });

  it("puts a saved built-in over the shipped one, marked as yours, and yours after the built-ins", () => {
    const merged = mergeAgents([reviewer, { ...builder, builtIn: undefined, soul: "Mine." }]);
    expect(merged.map((a) => a.id)).toEqual(["builder", "copywriter", "a-1"]);
    expect(merged[0]).toMatchObject({ soul: "Mine.", builtIn: true, changed: "you" });
    expect(merged[2]).toMatchObject({ name: "Reviewer", builtIn: undefined, changed: undefined });
  });

  it("keeps GitHub's mark, and reads a built-in saved only for its skills as unchanged", () => {
    const merged = mergeAgents([{ ...builder, soul: "Newer.", changed: "github" }, { ...BUILT_IN_AGENTS[1]!, builtIn: undefined, skillsOff: ["tdac"] }]);
    expect(merged[0]!.changed).toBe("github");
    expect(merged[1]).toMatchObject({ changed: undefined, skillsOff: ["tdac"] });
  });

  it("never lets a saved agent claim to be built in or changed", () => {
    expect(mergeAgents([{ ...reviewer, builtIn: true, changed: "you" }])[2]).toMatchObject({ builtIn: undefined, changed: undefined });
  });
});

describe("finding an agent", () => {
  const all = mergeAgents([reviewer]);

  it("finds by id among the agents given, the built-ins when none are", () => {
    expect(findAgent("a-1", all)).toBe(all[2]);
    expect(findAgent("a-1")).toBeUndefined();
    expect(findAgent(undefined, all)).toBeUndefined();
    expect(isAgent("a-1", all)).toBe(true);
    expect(isAgent("toString", all)).toBe(false);
    expect(isAgent(3, all)).toBe(false);
  });

  it("reads none, a deleted agent or an unknown one as Builder", () => {
    expect(agentOf(undefined, all)).toBe(all[0]);
    expect(agentOf("a-gone", all)).toBe(all[0]);
    expect(agentOf("poet")).toBe(builder);
    expect(agentOf("x", [reviewer])).toBe(builder);
  });

  it("stores Builder and unknown names as no agent, so old and new default cards read the same", () => {
    expect(storedAgent("builder", all)).toBeUndefined();
    expect(storedAgent("nope", all)).toBeUndefined();
    expect(storedAgent(undefined)).toBeUndefined();
    expect(storedAgent("copywriter")).toBe("copywriter");
    expect(storedAgent("a-1", all)).toBe("a-1");
  });
});

describe("weftSystemPrompt with an agent", () => {
  let prompts: typeof import("./weft-prompts");
  beforeEach(async () => {
    vi.resetModules();
    prompts = await import("./weft-prompts");
  });

  it("opens a copywriter's prompt with its soul instead of Builder's, and keeps the rest", () => {
    const builder = prompts.weftSystemPrompt({ backend: "claude" });
    const writer = prompts.weftSystemPrompt({ backend: "claude", agent: "copywriter" });
    expect(writer.startsWith(COPYWRITER_SOUL_PROMPT)).toBe(true);
    expect(writer).not.toContain(WEFT_SOUL_PROMPT);
    expect(writer.slice(COPYWRITER_SOUL_PROMPT.length)).toBe(builder.slice(WEFT_SOUL_PROMPT.length));
  });

  it("Builder named outright is the same prompt as no agent", () => {
    expect(prompts.weftSystemPrompt({ backend: "claude", agent: "builder" })).toBe(prompts.weftSystemPrompt({ backend: "claude" }));
  });

  it("the copilot keeps Weft's soul whatever agent it is handed", () => {
    expect(prompts.weftSystemPrompt({ backend: "claude", copilot: true, agent: "copywriter" })).toBe(prompts.weftSystemPrompt({ backend: "claude", copilot: true }));
  });

  it("pins every soul, so editing one replaces idle CLIs", () => {
    expect(prompts.WEFT_PINNED_PROMPTS.AGENT_SOULS).toBe(AGENT_SOULS);
  });
});

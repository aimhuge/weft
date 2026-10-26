import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_ORDER, AGENT_SOULS, AGENTS, agentOf, COPYWRITER_SOUL_PROMPT, isAgent, storedAgent, WEFT_SOUL_PROMPT } from "./agents";

// Who a thread is (docs/architecture/agents.md): its soul opens the system prompt.

vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  threadPrompt: () => "",
  subagentModel: () => "choose",
}));

describe("the agents", () => {
  it("knows Builder and Copywriter, and nothing else", () => {
    expect(AGENT_ORDER).toEqual(["builder", "copywriter"]);
    expect(isAgent("copywriter")).toBe(true);
    expect(isAgent("toString")).toBe(false);
    expect(isAgent(3)).toBe(false);
  });

  it("reads a card with no agent, or one it doesn't know, as Builder, Weft's own soul", () => {
    expect(agentOf(undefined)).toBe(AGENTS.builder);
    expect(agentOf("poet")).toBe(AGENTS.builder);
    expect(AGENTS.builder.soul).toBe(WEFT_SOUL_PROMPT);
    expect(agentOf("copywriter").soul).toBe(COPYWRITER_SOUL_PROMPT);
  });

  it("stores Builder and unknown names as no agent, so old and new default cards read the same", () => {
    expect(storedAgent("builder")).toBeUndefined();
    expect(storedAgent("nope")).toBeUndefined();
    expect(storedAgent(undefined)).toBeUndefined();
    expect(storedAgent("copywriter")).toBe("copywriter");
  });

  it("the copywriter writes in Weft's voice and still reads the project's own instructions", () => {
    for (const rule of ["your AI", "Weft is the subject", "No plumbing", "commit, push, deploy", "mcp__board__changelog_add", "SOUL.md"]) {
      expect(COPYWRITER_SOUL_PROMPT, rule).toContain(rule);
    }
  });

  it("every soul counts toward the prompt fingerprint", () => {
    for (const id of AGENT_ORDER) expect(AGENT_SOULS).toContain(AGENTS[id].soul);
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

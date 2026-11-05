import { beforeEach, describe, expect, it, vi } from "vitest";

// mcp__board__create_agent (lib/agent-tools.ts): a thread that knows what an agent should be writes one and saves
// it, so an agent is authored by a thread instead of typed into a text box by hand.

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  updated: [] as [string, unknown][],
  failWith: null as string | null,
}));

vi.mock("./agent-store", async () => {
  const { BUILT_IN_AGENTS } = await import("./agents");
  return {
    listAgents: () => [...BUILT_IN_AGENTS, { id: "a-1", name: "Reviewer", emoji: "🔍", tagline: "Reviews", soul: "You review." }],
    createAgent: (input: Record<string, unknown>) => {
      if (h.failWith) throw new Error(h.failWith);
      h.created.push(input);
      return { id: "a-9", name: input.name, emoji: input.emoji ?? "🤖", tagline: input.tagline ?? "", soul: input.soul };
    },
  };
});
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  updateCard: (id: string, patch: unknown) => {
    h.updated.push([id, patch]);
    return { id };
  },
}));

const { agentTools } = await import("./agent-tools");

type Reply = { content: { text: string }[]; isError?: boolean };

// The tool's handler, the way the SDK calls it. cardId null means the tool has no card to link.
async function call(input: Record<string, unknown>, cardId: string | null = "c1"): Promise<Reply> {
  const found = agentTools(() => (cardId === null ? undefined : cardId)).find((t) => t.name === "create_agent");
  if (!found) throw new Error("no create_agent tool");
  return (await found.handler(input as Parameters<typeof found.handler>[0], {})) as Reply;
}

beforeEach(() => {
  h.created = [];
  h.updated = [];
  h.failWith = null;
});

describe("create_agent", () => {
  it("saves the agent the thread wrote, with its name, emoji, one line and soul", async () => {
    const reply = await call({
      name: "Reviewer",
      soul: "Read the diff before you judge anything.",
      emoji: "🔍",
      tagline: "Reviews pull requests",
    });
    expect(h.created).toEqual([
      { name: "Reviewer", soul: "Read the diff before you judge anything.", emoji: "🔍", tagline: "Reviews pull requests" },
    ]);
    expect(reply.content[0]?.text).toContain("Reviewer");
    expect(reply.isError).toBeFalsy();
  });

  it("links the card that wrote it, so Settings can say which thread built the agent", async () => {
    await call({ name: "Reviewer", soul: "You review." });
    expect(h.updated).toEqual([["c1", { agentId: "a-9" }]]);
  });

  it("saves without a card to link, like the copilot's own tool", async () => {
    const reply = await call({ name: "Planner", soul: "You plan." }, null);
    expect(h.updated).toEqual([]);
    expect(reply.content[0]?.text).toContain("Planner");
  });

  it("says why it couldn't be saved, and saves nothing", async () => {
    h.failWith = "An agent needs a name.";
    const reply = await call({ name: "", soul: "s" });
    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toContain("An agent needs a name.");
    expect(h.created).toEqual([]);
  });
});

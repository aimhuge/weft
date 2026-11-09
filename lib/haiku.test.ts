import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ messages: [] as unknown[], calls: [] as unknown[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => {
    sdk.calls.push(args);
    return (function* () {
      yield* sdk.messages;
    })();
  },
}));

const { complete } = await import("./haiku");

beforeEach(() => {
  sdk.messages = [];
  sdk.calls = [];
});

describe("complete", () => {
  // This one pays the SDK's first import, which is ~0.3s alone but ran to 4.8s against the default 5s
  // timeout in a full sweep on a loaded box (2026-10-22). The timeout is for that import, not the assertions.
  it("runs one bare Haiku turn: no tools, settings, MCP or session file", { timeout: 20_000 }, async () => {
    sdk.messages = [{ type: "result", subtype: "success", result: "hi" }];
    await complete("say hi");
    expect(sdk.calls).toEqual([
      {
        prompt: "say hi",
        options: { model: "haiku", tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: 1 },
      },
    ]);
  });

  it("passes a stronger model through to the query when asked", async () => {
    sdk.messages = [{ type: "result", subtype: "success", result: "ok" }];
    await complete("x", "sonnet");
    expect((sdk.calls[0] as { options: { model: string } }).options.model).toBe("sonnet");
  });

  it("returns the successful result's text, ignoring other messages", async () => {
    sdk.messages = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "draft" }] } },
      { type: "result", subtype: "success", result: "final answer" },
    ];
    await expect(complete("q")).resolves.toBe("final answer");
  });

  it("returns an empty string when the turn ends in an error result", async () => {
    sdk.messages = [{ type: "result", subtype: "error_max_turns" }];
    await expect(complete("q")).resolves.toBe("");
  });

  it("returns an empty string when no result arrives", async () => {
    await expect(complete("q")).resolves.toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { poolKey, poolOf, samePool } from "./plan-pools";

// Each CLI has its own plan. Claude Code runs on Anthropic's subscription and reads the claude.ai
// account's 5-hour and weekly windows; puku-cli bills through Puku's gateway and has no Anthropic
// plan limit; Codex runs OpenAI's. So no two CLIs share a counter.

describe("poolOf", () => {
  it("gives every CLI its own pool", () => {
    expect(poolOf("claude")).toEqual(["claude"]);
    expect(poolOf("puku")).toEqual(["puku"]);
    expect(poolOf("codex")).toEqual(["codex"]);
    expect(poolOf("goose")).toEqual(["goose"]);
  });
});

describe("samePool", () => {
  it("is false for two different CLIs, whatever they are", () => {
    // Claude Code's spent 5-hour window says nothing about a puku thread: puku is on Puku's plan.
    expect(samePool("claude", "puku")).toBe(false);
    expect(samePool("puku", "claude")).toBe(false);
    expect(samePool("claude", "codex")).toBe(false);
    expect(samePool("claude", "goose")).toBe(false);
    expect(samePool("codex", "goose")).toBe(false);
  });

  it("is true for a CLI with itself", () => {
    expect(samePool("codex", "codex")).toBe(true);
    expect(samePool("puku", "puku")).toBe(true);
  });
});

describe("poolKey", () => {
  it("names a pool by its own CLI, so the plan has one key", () => {
    expect(poolKey("claude")).toBe("claude");
    expect(poolKey("puku")).toBe("puku");
    expect(poolKey("codex")).toBe("codex");
    expect(poolKey("goose")).toBe("goose");
  });
});

import { describe, expect, it, vi } from "vitest";
import { attribution, gooseAttribution, gooseAttributionPrompt, modelName, signAsWeft } from "./attribution";

describe("modelName", () => {
  it("names a Claude model from its id", () => {
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelName("claude-sonnet-5-5[1m]")).toBe("Claude Sonnet 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelName("claude-opus-4")).toBe("Claude Opus 4");
  });

  it("falls back to Claude for aliases, other models and no model", () => {
    expect(modelName("opus")).toBe("Claude");
    expect(modelName("puku-ai-2.8")).toBe("Claude");
    expect(modelName(undefined)).toBe("Claude");
  });
});

describe("attribution", () => {
  it("signs commits and PRs as Claude on Weft", () => {
    expect(attribution("claude-opus-5-5")).toEqual({
      commit: "Co-Authored-By: Claude Opus 5.5 on Weft <noreply@anthropic.com>",
      pr: "🤖 Generated with [Claude Code](https://claude.com/claude-code) on Weft",
    });
  });
});

describe("signAsWeft", () => {
  const cli = () => ({ applyFlagSettings: vi.fn(async () => {}) });

  it("gives a Claude Code board thread the Weft attribution", () => {
    const q = cli();
    signAsWeft(q, { backend: "claude" }, "claude-sonnet-5-5");
    expect(q.applyFlagSettings).toHaveBeenCalledWith({ attribution: attribution("claude-sonnet-5-5") });
  });

  it("leaves the copilot and puku-cli alone, and survives a CLI that refuses", async () => {
    const q = cli();
    signAsWeft(q, { backend: "claude", copilot: true }, undefined);
    signAsWeft(q, { backend: "puku" }, undefined);
    expect(q.applyFlagSettings).not.toHaveBeenCalled();
    signAsWeft({ applyFlagSettings: () => Promise.reject(new Error("gone")) }, { backend: "claude" }, undefined);
    signAsWeft(undefined, { backend: "claude" }, undefined);
    await Promise.resolve();
  });
});

// Goose has no attribution setting, so its lines go in its system text; they name Goose and the model it ran.
describe("gooseAttribution", () => {
  it("signs commits as Goose on Weft, with the model when there is one", () => {
    expect(gooseAttribution("openai/gpt-4.1").commit).toBe("Co-Authored-By: Goose (openai/gpt-4.1) on Weft <noreply@weft.zip>");
    expect(gooseAttribution(undefined).commit).toBe("Co-Authored-By: Goose on Weft <noreply@weft.zip>");
    expect(gooseAttribution(undefined).pr).toBe("🤖 Generated with [Goose](https://github.com/aaif-goose/goose) on Weft");
  });

  it("words the instruction with both lines", () => {
    const text = gooseAttributionPrompt("puku-ai-2.8");
    expect(text).toContain("End git commit messages with:\nCo-Authored-By: Goose (puku-ai-2.8) on Weft <noreply@weft.zip>");
    expect(text).toContain("End pull request descriptions with:\n🤖 Generated with [Goose]");
  });
});

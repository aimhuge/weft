import { describe, expect, it } from "vitest";
import { isSubagentModel, pukuSubagentModel, subagentBackend, subagentEnv, subagentLabel, subagentPrompt } from "./subagents";

describe("subagents", () => {
  it("knows every model either CLI serves, plus choose and inherit", () => {
    for (const m of ["choose", "inherit", "claude-fable-5-1", "claude-haiku-5-5", "opus-4.8", "puku-ai-2.7"]) expect(isSubagentModel(m), m).toBe(true);
    for (const m of ["haiku", "gpt-5", "", undefined, 3]) expect(isSubagentModel(m), String(m)).toBe(false);
    expect(subagentBackend("opus-4.8")).toBe("puku");
    expect(subagentBackend("claude-opus-5-5")).toBe("claude");
    expect(subagentBackend("inherit")).toBeUndefined();
  });

  it("labels a model with its CLI", () => {
    expect(subagentLabel("claude-fable-5-1")).toBe("Fable 5.1 (Claude)");
    expect(subagentLabel("opus-4.8")).toBe("Opus 4.8 (Puku)");
    expect(subagentLabel("choose")).toBe("Let the model choose");
    expect(subagentLabel("inherit")).toBe("Same model as the thread");
    expect(subagentLabel("mystery")).toBe("mystery");
  });

  it("asks a Claude thread to delegate and, when it chooses, how to pick the model", () => {
    const choose = subagentPrompt("choose", "claude");
    expect(choose).toMatch(/^Use subagents/);
    expect(choose).toMatch(/haiku:[\s\S]*sonnet:[\s\S]*opus:/);
    expect(subagentPrompt("choose", "puku")).not.toContain("haiku:");
    expect(subagentPrompt("inherit", "puku")).toContain("same model as this thread");
  });

  it("forces a model the thread's own CLI serves through that CLI's env", () => {
    expect(subagentPrompt("claude-sonnet-5-5", "claude")).toContain("Subagents run on Sonnet 5.5 (Claude) (the user's Weft setting), so leave");
    expect(subagentEnv("claude-sonnet-5-5", "claude")).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-5-5", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect(subagentEnv("puku-ai-2.8", "puku")).toEqual({ PUKU_CLI_SUBAGENT_MODEL: "puku-ai-2.8" });
    expect(subagentEnv("puku-ai-2.7", "puku")).toEqual({ PUKU_CLI_SUBAGENT_MODEL: "puku-ai-2.7" });
    // puku-cli's pinned list calls it "opus"; "opus-4.8" makes it refuse every subagent.
    expect(subagentEnv("opus-4.8", "puku")).toEqual({ PUKU_CLI_SUBAGENT_MODEL: "opus" });
    expect(pukuSubagentModel("haiku")).toBe("opus");
    expect(subagentEnv("inherit", "claude")).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "inherit", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect(subagentEnv("inherit", "puku")).toEqual({});
    expect(subagentEnv("choose", "claude")).toEqual({});
  });

  it("runs the other CLI's model headless with Bash, and sets no env for it", () => {
    const onClaude = subagentPrompt("opus-4.8", "claude");
    expect(onClaude).toContain('puku-cli -p "<self-contained task>" --model opus-4.8 --allowedTools "Read Grep Glob" --permission-mode dontAsk');
    expect(onClaude).toContain("Opus 4.8 (Puku)");
    expect(subagentPrompt("claude-haiku-5-5", "puku")).toContain("claude -p \"<self-contained task>\" --model claude-haiku-5-5");
    expect(subagentEnv("opus-4.8", "claude")).toEqual({});
    expect(subagentEnv("claude-haiku-5-5", "puku")).toEqual({});
  });
});

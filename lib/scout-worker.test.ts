import { describe, expect, it } from "vitest";
import { scoutPrompt } from "./scout-prompt";
import { workerScoutPrompt } from "./scout-worker";

describe("workerScoutPrompt", () => {
  it("is the scout's own instructions, saved with scout-save.mjs, read-only for the project", () => {
    const { prompt, title } = workerScoutPrompt();
    expect(title).toBe("Re-scout for refactors");
    expect(prompt).toContain("You are a refactor scout.");
    expect(prompt).toContain("Write the findings as a JSON array");
    expect(prompt).not.toContain("Reply with only a JSON array");
    expect(prompt).toContain("scout-save.mjs");
    expect(prompt).toContain("don't edit any of its files");
    expect(scoutPrompt()).toContain("Reply with only a JSON array");
  });
});

import { describe, expect, it } from "vitest";

// The brief the authoring thread runs on (lib/agent-author.ts): a soul is the first part of every system prompt
// the agent's threads get, so the brief has to say what a good one is, or the thread writes a line of wishes.

import { agentAuthorPrompt } from "./agent-author";

describe("agentAuthorPrompt", () => {
  it("puts the user's brief in, so the thread knows what the agent is for", () => {
    const prompt = agentAuthorPrompt("Reviews pull requests before they merge.");
    expect(prompt).toContain("Reviews pull requests before they merge.");
  });

  it("says a soul is instructions, not a description", () => {
    const prompt = agentAuthorPrompt("Reviews code.");
    expect(prompt).toContain("standing instructions");
    expect(prompt).toContain("not as a description of it");
  });

  it("says what a soul covers, in the order it should", () => {
    const prompt = agentAuthorPrompt("Reviews code.");
    for (const part of ["Who the agent is", "What it reads first", "What it makes", "How it shows its work", "when it should stop and ask"]) {
      expect(prompt).toContain(part);
    }
  });

  it("tells the thread to save the agent with the tool", () => {
    expect(agentAuthorPrompt("Reviews code.")).toContain("create_agent");
  });

  it("leaves out what every thread already has", () => {
    const prompt = agentAuthorPrompt("Reviews code.");
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("browser pane");
  });

  it("trims the brief and keeps it whole", () => {
    expect(agentAuthorPrompt("  Reviews code.  ")).toContain("Reviews code.");
  });
});

import { describe, expect, it } from "vitest";
import { ASK_BUTTONS_PROMPT, decisionsPrompt, MIGRATIONS_PROMPT } from "./decisions-prompt";

describe("decisionsPrompt", () => {
  it("tells a thread to apply its own migration and ask only before destroying data", () => {
    expect(MIGRATIONS_PROMPT).toContain("apply it yourself in the same turn");
    expect(MIGRATIONS_PROMPT).toContain("mcp__supabase__apply_migration");
    expect(MIGRATIONS_PROMPT).toContain("`git mv`");
    expect(MIGRATIONS_PROMPT).toContain("Ask first only when it drops or rewrites data");
  });

  it("gives Claude and puku threads the buttons rule after the migrations rule", () => {
    for (const backend of ["claude", "puku"] as const) expect(decisionsPrompt(backend)).toBe(`${MIGRATIONS_PROMPT}\n\n${ASK_BUTTONS_PROMPT}`);
    expect(ASK_BUTTONS_PROMPT).toContain("AskUserQuestion");
  });

  it("leaves the buttons rule out for Codex, which has no AskUserQuestion", () => {
    expect(decisionsPrompt("codex")).toBe(MIGRATIONS_PROMPT);
    expect(decisionsPrompt("antigravity")).toBe(MIGRATIONS_PROMPT);
  });
});

import { describe, expect, it } from "vitest";
import { runCardTitle, runPrompt } from "./intake-run";
import type { IntakeResult } from "./project-intake";

const NONE: IntakeResult = { imported: 0, importedFrom: [], blanks: 0, hooks: 0, tracked: [] };

describe("intake run card", () => {
  it("names the project in its title and prompt, and starts the server through Weft", () => {
    expect(runCardTitle("/dev/shop")).toBe("▶ Get shop running");
    const prompt = runPrompt("/dev/shop");
    expect(prompt).toContain("shop (/dev/shop)");
    expect(prompt).toContain("mcp__devservers__start");
    expect(prompt).toContain("mcp__secrets__ask_add");
    expect(prompt).not.toContain("webhook route");
    expect(prompt).toContain("at most once: call mcp__secrets__request_access a single time");
  });

  it("carries the blanks, the webhooks and the files to rotate, by name", () => {
    const prompt = runPrompt("/dev/shop", {
      ...NONE,
      tracked: [".env", ".env.prod"],
      details: {
        imported: [],
        blanks: [{ name: "HF_TOKEN", source: "your code", hint: "Hugging Face → Access Tokens" }, { name: "B_KEY", source: ".env.example" }],
        hooks: [{ name: "stripe", target: "/api/stripe/webhook", provider: "stripe", events: ["checkout.session.completed"] }, { name: "gh", target: "/api/gh" }],
      },
    });
    expect(prompt).toContain("- HF_TOKEN (from your code): Hugging Face → Access Tokens");
    expect(prompt).toContain("- B_KEY (from .env.example)\n");
    expect(prompt).toContain("- stripe: /api/stripe/webhook (signed by stripe), events checkout.session.completed");
    expect(prompt).toContain("- gh: /api/gh\n");
    expect(prompt).toContain("Leave them for later");
    expect(prompt).toContain(".env, .env.prod are committed to git");
  });

  it("says 'is' for one committed file", () => {
    expect(runPrompt("/dev/shop", { ...NONE, tracked: [".env"] })).toContain(".env is committed to git");
  });
});

import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import { workerPromptHits } from "./worker-prompt-search";

const card = (id: string, cwd: string, prompt: string) => ({ id, cwd, prompt }) as Card;

describe("workerPromptHits", () => {
  it("matches a worker card's prompt, never this Mac's (its index answers for those)", () => {
    const cards = [card("l", "/r", "fix the login"), card("w", "worker://w1/ling", "Fix the LOGIN page"), card("n", "worker://w1/ling", "other")];
    expect(workerPromptHits(cards, " login ")).toEqual([{ cardId: "w", snippet: "Fix the LOGIN page" }]);
    expect(workerPromptHits(cards, "  ")).toEqual([]);
  });

  it("cuts a long prompt round the match", () => {
    const long = `${"a".repeat(100)}needle${"b".repeat(100)}`;
    const [hit] = workerPromptHits([card("w", "worker://w1/ling", long)], "needle");
    expect(hit?.snippet).toBe(`…${"a".repeat(60)}needle${"b".repeat(60)}…`);
  });
});

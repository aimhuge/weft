import { describe, expect, it } from "vitest";
import { workerProjectCards, workerSprintPrompt } from "./sprint-worker";
import type { Card } from "./types";

const CWD = "worker://w1/ling";
const card = (o: Partial<Card>) => ({ id: "c", title: "T", prompt: "p", column: "backlog", cwd: CWD, createdAt: 1, ...o }) as Card;
const NOW = 1_000_000;

describe("workerProjectCards", () => {
  it("keeps the project's open cards", () => {
    const cards = [
      card({ id: "a" }),
      card({ id: "sub", cwd: `${CWD}/app` }),
      card({ id: "other", cwd: "worker://w1/lingo" }),
      card({ id: "arch", archived: true }),
      card({ id: "pilot", role: "copilot" }),
      card({ id: "fin", column: "done" }),
    ];
    expect(workerProjectCards(cards, CWD).map((c) => c.id)).toEqual(["a", "sub"]);
  });
});

describe("workerSprintPrompt", () => {
  it("lists the Backlog oldest first and the cards at work, and starts nothing by curl", () => {
    const cards = [
      card({ id: "b2", title: "Second", prompt: "  two\n lines ", createdAt: 5, tags: ["ui"] }),
      card({ id: "b1", title: "First", prompt: "", createdAt: 2 }),
      card({ id: "r1", title: "Busy", column: "running", stage: "build", remaining: "tests" }),
      card({ id: "r2", title: "Quiet", column: "review" }),
    ];
    const { prompt, title } = workerSprintPrompt({ root: "ling", count: 2, active: 2 }, cards, CWD, NOW);
    expect(title).toBe("Plan the ling backlog into sprints");
    expect(prompt).toContain("Plan the Backlog of ling into sprints: 2 cards wait there.");
    expect(prompt.indexOf('"First"')).toBeLessThan(prompt.indexOf('"Second"'));
    expect(prompt).toContain("asks: (no prompt)");
    expect(prompt).toContain("asks: two lines");
    expect(prompt).toContain("tagged ui");
    expect(prompt).toContain('"Busy" (card r1, running; stage build; remaining: tests)');
    expect(prompt).toContain('"Quiet" (card r2, review)');
    expect(prompt).toContain("mcp__board__create_card");
    expect(prompt).not.toContain("curl");
  });

  it("falls back to the snapshot's count when the board's list is empty", () => {
    const { prompt } = workerSprintPrompt({ root: "ling", count: 1, active: 0 }, [], CWD, NOW);
    expect(prompt).toContain("1 card wait there");
    expect(prompt).toContain("mcp__board__list_cards");
    expect(prompt).not.toContain("Already at work");
  });
});

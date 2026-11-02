import { describe, expect, it } from "vitest";
import { workerPilePrompt } from "./pile-worker";

describe("workerPilePrompt", () => {
  it("asks the worker's card to commit by path, from the snapshot's counts", () => {
    const { prompt, title } = workerPilePrompt({ root: "app", files: 4, added: 30, removed: 5, cards: 0 });
    expect(title).toBe("Commit the uncommitted pile in app");
    expect(prompt).toContain("in app: 4 files, +30/-5 lines. Several");
    expect(prompt).toContain("git commit -m");
    expect(prompt).toContain("never `git stash`");
    expect(workerPilePrompt({ root: "app", files: 1, added: 1, removed: 0, cards: 2 }).prompt).toContain("from 2 cards in Review");
  });
});

// The one rule for which card a card folds under (lib/cron-fold.ts).
import { describe, expect, it } from "vitest";
import { foldParentOf, isSelfHolder } from "./cron-fold";
import type { Card } from "./types";

let seq = 0;
function card(overrides: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${seq}`,
    title: "Untitled",
    prompt: "do it",
    cwd: "/dev/weft",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("foldParentOf", () => {
  it("folds a cron run under the card it came from", () => {
    expect(foldParentOf(card({ id: "run", cronOf: "c1" }))).toBe("c1");
  });

  it("falls back to the thread that started the card", () => {
    expect(foldParentOf(card({ parentId: "c2" }))).toBe("c2");
    expect(foldParentOf(card())).toBeUndefined();
  });

  it("ignores a cron that points at the card itself", () => {
    expect(foldParentOf(card({ id: "c9", cronOf: "c9" }))).toBeUndefined();
    expect(foldParentOf(card({ id: "c9", cronOf: "c9", parentId: "c3" }))).toBe("c3");
  });
});

describe("isSelfHolder", () => {
  it("is true only for a run that points at itself", () => {
    expect(isSelfHolder(card({ id: "c9", cronOf: "c9" }))).toBe(true);
    expect(isSelfHolder(card({ id: "c9", cronOf: "other" }))).toBe(false);
    expect(isSelfHolder(card())).toBe(false);
  });
});

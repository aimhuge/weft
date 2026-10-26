import { describe, expect, it } from "vitest";
import { stackRuns } from "./cron-stacks";
import type { Card, Column } from "./types";

// A card is only as interesting as the fields the stack reads, so the test builds the minimum it needs.
const card = (id: string, over: Partial<Card> = {}): Card =>
  ({
    id,
    title: id,
    prompt: "",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "default",
    column: "review",
    createdAt: 0,
    ...over,
  }) as Card;

const columns = (...lists: [Column, Card[]][]): Map<Column, Card[]> => new Map(lists);

describe("stackRuns", () => {
  it("takes a run out of its column and lists it under the holder on the board", () => {
    const holder = card("h1", { column: "review" });
    const run = card("r1", { column: "review", cronOf: "h1", cronRun: 2 });
    const result = stackRuns(columns(["review", [holder, run]]));
    expect(result.byColumn.get("review")).toEqual([holder]);
    expect(result.stacks.get("h1")).toEqual([run]);
  });

  it("keeps a run where it is when its holder isn't on the board", () => {
    const run = card("r1", { column: "review", cronOf: "gone", cronRun: 1 });
    const result = stackRuns(columns(["review", [run]]));
    expect(result.byColumn.get("review")).toEqual([run]);
    expect(result.stacks.size).toBe(0);
  });

  it("keeps a run that waits on you in Needs you as well as in the stack", () => {
    const holder = card("h1", { column: "review" });
    const run = card("r1", { column: "needs_you", cronOf: "h1", cronRun: 1 });
    const result = stackRuns(columns(["needs_you", [run]], ["review", [holder]]));
    expect(result.byColumn.get("needs_you")).toEqual([run]);
    expect(result.stacks.get("h1")).toEqual([run]);
  });

  it("doesn't stack a card whose holder is itself", () => {
    const card1 = card("c1", { cronOf: "c1", cronRun: 1 });
    const result = stackRuns(columns(["review", [card1]]));
    expect(result.byColumn.get("review")).toEqual([card1]);
    expect(result.stacks.size).toBe(0);
  });

  it("doesn't stack a card that isn't a run at all", () => {
    const plain = card("p1");
    const result = stackRuns(columns(["review", [plain]]));
    expect(result.byColumn.get("review")).toEqual([plain]);
    expect(result.stacks.size).toBe(0);
  });

  it("lists the runs newest first", () => {
    const holder = card("h1", { column: "review" });
    const older = card("r1", { column: "review", cronOf: "h1", cronRun: 1 });
    const newer = card("r2", { column: "review", cronOf: "h1", cronRun: 3 });
    const result = stackRuns(columns(["review", [holder, older, newer]]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r2", "r1"]);
  });

  it("breaks a tie on the run number by the card's age, newest first", () => {
    const holder = card("h1", { column: "review" });
    const older = card("r1", { column: "review", cronOf: "h1", cronRun: 2, createdAt: 100 });
    const newer = card("r2", { column: "review", cronOf: "h1", cronRun: 2, createdAt: 200 });
    const result = stackRuns(columns(["review", [holder, older, newer]]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r2", "r1"]);
  });

  it("keeps runs without a run number, sorting them last", () => {
    const holder = card("h1", { column: "review" });
    const numbered = card("r1", { column: "review", cronOf: "h1", cronRun: 1, createdAt: 100 });
    const unnumbered = card("r2", { column: "review", cronOf: "h1", createdAt: 200 });
    const result = stackRuns(columns(["review", [holder, numbered, unnumbered]]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r1", "r2"]);
  });

  it("puts a run with no run number behind one that has one, either way round", () => {
    const holder = card("h1", { column: "review" });
    const unnumbered = card("r1", { column: "review", cronOf: "h1", createdAt: 100 });
    const numbered = card("r2", { column: "review", cronOf: "h1", cronRun: 1, createdAt: 200 });
    const result = stackRuns(columns(["review", [holder, unnumbered, numbered]]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r2", "r1"]);
  });

  it("keeps runs of the same age in the order they came in", () => {
    const holder = card("h1", { column: "review" });
    const first = card("r1", { column: "review", cronOf: "h1", cronRun: 1, createdAt: 100 });
    const second = card("r2", { column: "review", cronOf: "h1", cronRun: 1, createdAt: 100 });
    const result = stackRuns(columns(["review", [holder, first, second]]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r1", "r2"]);
  });

  it("stacks under each holder and leaves the columns that have none", () => {
    const h1 = card("h1", { column: "review" });
    const h2 = card("h2", { column: "review" });
    const r1 = card("r1", { column: "review", cronOf: "h1", cronRun: 1 });
    const r2 = card("r2", { column: "done", cronOf: "h2", cronRun: 1 });
    const result = stackRuns(columns(["review", [h1, h2, r1]], ["done", [r2]], ["backlog", []]));
    expect(result.stacks.get("h1")?.map((c) => c.id)).toEqual(["r1"]);
    expect(result.stacks.get("h2")?.map((c) => c.id)).toEqual(["r2"]);
    expect(result.byColumn.get("review")).toEqual([h1, h2]);
    expect(result.byColumn.get("done")).toEqual([]);
    expect(result.byColumn.get("backlog")).toEqual([]);
  });
});

// A changed-cards read laid over the last whole one (lib/worker-board-merge.ts).
import { describe, expect, it } from "vitest";
import type { Card } from "./types";
import { mergeBoard } from "./worker-board-merge";
import type { WorkerBoard, WorkerProject } from "./worker-project";

const card = (id: string, title = id) => ({ id, title, cwd: "worker://w1/ling", column: "review" }) as unknown as Card;
const project = (over: Partial<WorkerProject> = {}) => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1", folder: "ling", status: "online" as const, ...over });
const board = (over: Partial<WorkerBoard> = {}): WorkerBoard => ({ signedIn: true, projects: [], cards: [], ...over });

describe("mergeBoard", () => {
  it("takes a whole read as it is", () => {
    const next = board({ cards: [card("a")], asOf: "t1" });
    expect(mergeBoard(board({ cards: [card("old")] }), next)).toBe(next);
  });

  it("puts the changed cards first and keeps the rest", () => {
    const prev = board({ cards: [card("a"), card("b", "old b"), card("c")] });
    const merged = mergeBoard(prev, board({ delta: true, asOf: "t2", cards: [card("b", "new b")] }));
    expect(merged.cards.map((c) => c.title)).toEqual(["new b", "a", "c"]);
    expect(merged.asOf).toBe("t2");
    expect(merged.delta).toBeUndefined();
  });

  it("adds a card it hasn't seen", () => {
    const merged = mergeBoard(board({ cards: [card("a")] }), board({ delta: true, cards: [card("n")] }));
    expect(merged.cards.map((c) => c.id)).toEqual(["n", "a"]);
  });

  it("keeps a project the changed read leaves out, with its worker's status now", () => {
    const prev = board({ projects: [project(), project({ path: "worker://w1/other", folder: "other" }), project({ path: "worker://w2/x", workerId: "w2" })] });
    const next = board({ delta: true, projects: [project({ status: "busy" })] });
    const merged = mergeBoard(prev, next);
    expect(merged.projects.map((p) => [p.path, p.status])).toEqual([
      ["worker://w1/ling", "busy"],
      ["worker://w1/other", "busy"],
      ["worker://w2/x", "online"],
    ]);
  });

  it("leaves out asOf when the read had none", () => {
    expect("asOf" in mergeBoard(board(), board({ delta: true }))).toBe(false);
  });

  it("drops the cards the read says are gone", () => {
    const prev = board({ cards: [card("a"), card("b"), card("c")] });
    const merged = mergeBoard(prev, board({ delta: true, removed: ["b", "c"], cards: [] }));
    expect(merged.cards.map((c) => c.id)).toEqual(["a"]);
  });
});

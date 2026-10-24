// Where a card goes when a turn ends (lib/turn.ts columnAfterTurn): the thread's status line asks for
// a column, a stop or an error overrides it, and a wrap-up that ends asking for something is still
// a finished wrap-up, so it goes to Done and is filed away.
import { describe, expect, it } from "vitest";
import { columnAfterTurn } from "./turn";
import type { BoardStatus } from "./status";

describe("columnAfterTurn", () => {
  it("returns review when stopped, even if status asks for another column", () => {
    const status: BoardStatus = { column: "done", stage: "Done" };
    expect(columnAfterTurn(true, false, status)).toBe("review");
    expect(columnAfterTurn(true, false, undefined)).toBe("review");
  });

  it("returns review on error, even if status asks for another column", () => {
    const status: BoardStatus = { column: "needs_you" };
    expect(columnAfterTurn(false, true, status)).toBe("review");
  });

  it("returns the status column when not stopped and not an error", () => {
    expect(columnAfterTurn(false, false, { column: "done" })).toBe("done");
    expect(columnAfterTurn(false, false, { column: "needs_you" })).toBe("needs_you");
    expect(columnAfterTurn(false, false, { column: "review" })).toBe("review");
  });

  it("returns review when there is no status and nothing else forces it", () => {
    expect(columnAfterTurn(false, false, undefined)).toBe("review");
  });

  it("a wrap-up that ends needing you goes to Done, not Needs you", () => {
    expect(columnAfterTurn(false, false, { column: "needs_you" }, true)).toBe("done");
    expect(columnAfterTurn(false, false, { column: "done" }, true)).toBe("done");
    expect(columnAfterTurn(false, false, { column: "review" }, true)).toBe("review");
  });

  it("a plain turn that ends needing you still waits in Needs you", () => {
    expect(columnAfterTurn(false, false, { column: "needs_you" }, false)).toBe("needs_you");
  });
});

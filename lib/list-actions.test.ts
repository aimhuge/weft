import { describe, expect, it } from "vitest";
import { knownFolders, statusActions } from "./list-actions";
import type { Card, PendingPermission } from "./types";

let seq = 0;
function card(over: Partial<Card> = {}): Card {
  seq += 1;
  return {
    id: `c${seq}`,
    title: "T",
    prompt: "p",
    cwd: "/dev/weft",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}
const ids = (c: Card, column = c.column) => statusActions(c, column).map((i) => i.id);

describe("statusActions", () => {
  it("offers Run and Review for a Backlog card", () => {
    expect(ids(card())).toEqual(["open", "run", "move:review"]);
  });

  it("offers only Stop on a running card, and on one waiting on you", () => {
    expect(ids(card({ column: "running" }))).toEqual(["open", "stop"]);
    expect(ids(card({ column: "needs_you", pending: { id: "p" } as PendingPermission }))).toEqual(["open", "stop"]);
  });

  it("offers Continue and Restart when the card can, and the parking moves", () => {
    const stopped = card({ column: "review", sessionId: "s", lastLine: "Stopped by you" });
    expect(ids(stopped)).toEqual(["open", "continue", "restart", "move:backlog"]);
    expect(ids(card({ column: "done" }))).toEqual(["open", "move:backlog", "move:review"]);
  });

  it("marks Stop as the dangerous one", () => {
    expect(statusActions(card({ column: "running" }), "running").find((i) => i.id === "stop")?.danger).toBe(true);
  });
});

describe("knownFolders", () => {
  it("lists every card's folder once, most recently busy first, without the copilot", () => {
    const cards = [
      card({ cwd: "/a", updatedAt: 10 }),
      card({ cwd: "/b", updatedAt: 5, lastActivity: 50 }),
      card({ cwd: "/a", updatedAt: 20 }),
      card({ cwd: "/board", role: "copilot", updatedAt: 99 }),
    ];
    expect(knownFolders(cards)).toEqual(["/b", "/a"]);
  });
});

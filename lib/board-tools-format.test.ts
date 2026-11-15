import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

const cards = new Map<string, Card>();
let thread: ThreadItem[] = [];
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id), getThread: () => thread }));

import { boardCard, cardLine, describeBoardTool, readThreadText } from "./board-tools-format";

const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Title", column: "running", backend: "claude", cwd: "/Users/me/dev/app", ...over }) as Card;

beforeEach(() => {
  cards.clear();
  thread = [];
});

describe("boardCard", () => {
  it("refuses unknown ids and the copilot", () => {
    cards.set("cp", card({ id: "cp", role: "copilot" }));
    expect(() => boardCard("nope")).toThrow("No card nope");
    expect(() => boardCard("cp")).toThrow("No card cp");
    cards.set("c1", card());
    expect(boardCard("c1").id).toBe("c1");
  });
});

describe("describeBoardTool", () => {
  it("reads each tool that needs the user's OK", () => {
    cards.set("c1", card({ title: "Fix it", pending: { title: "run ls" } as Card["pending"] }));
    expect(describeBoardTool("mcp__board__start_card", { card_id: "c1" })).toBe("Start “Fix it”");
    expect(describeBoardTool("mcp__board__send_message", { card_id: "c1", text: "go" })).toBe("Reply to “Fix it”: go");
    expect(describeBoardTool("mcp__board__answer_permission", { card_id: "c1", allow: true })).toBe("Allow run ls on “Fix it”");
    expect(describeBoardTool("mcp__board__answer_permission", { card_id: "zz", allow: false })).toBe("Deny its request on zz");
    expect(describeBoardTool("mcp__board__restart_weft_when_idle", {})).toBe("Restart Weft once the running threads finish");
    expect(describeBoardTool("mcp__board__share_card", {})).toMatch(/^Publish this card at a public weft.zip link/);
    expect(describeBoardTool("mcp__board__share_card", { public: false })).toBe("Make this card's share link private");
    expect(describeBoardTool("mcp__board__list_cards", {})).toBeNull();
  });

  it("falls back to 'a card' without an id", () => {
    expect(describeBoardTool("start_card", {})).toBe("Start a card");
  });
});

describe("cardLine", () => {
  it("shows the bare minimum", () => {
    expect(cardLine(card())).toBe("c1 | running | Title | ~/dev/app");
  });

  it("adds every extra it has", () => {
    const line = cardLine(
      card({ starred: true, tags: ["a", "b"], stage: "Polishing", remaining: "ship", pending: { title: "ok?" } as Card["pending"], error: "boom\nmore", lastLine: "done\nx" }),
    );
    expect(line).toBe("c1 | running | ★ Title | ~/dev/app | tags: a, b | Polishing | remaining: ship | waiting on: ok? | error: boom | latest: done");
  });
});

describe("readThreadText", () => {
  it("describes the card and every kind of thread item", () => {
    cards.set("c1", card({ stage: "Planning", remaining: "x", lastLine: "hi", pending: { title: "p" } as Card["pending"], error: "e" }));
    thread = [
      { kind: "assistant", text: "a" },
      { kind: "tool", name: "mcp__x__Bash", summary: "ls", isError: false },
      { kind: "tool", name: "Bash", summary: "rm", isError: true },
      { kind: "permission", title: "run", decision: "deny" },
      { kind: "permission", title: "wait" },
      { kind: "result", text: "t", isError: false },
      { kind: "result", text: "boom", isError: true },
      { kind: "shell", command: "ls", exitCode: 0 },
      { kind: "shell", command: "false", exitCode: 1 },
      { kind: "notification", status: "completed", summary: "Background command \"tests\" completed" },
      { kind: "user", text: "u" },
    ] as ThreadItem[];
    const text = readThreadText("c1");
    expect(text).toContain("stage: Planning");
    expect(text).toContain("waiting on the user for: p");
    expect(text).toContain("error: e");
    expect(text).toContain("USER RAN: ! ls\n\nUSER RAN: ! false (exit 1)");
    expect(text).toContain("USER: u");
    expect(text).toContain("AGENT: a");
    expect(text).toContain("(failed)");
    expect(text).toContain("PERMISSION run: deny");
    expect(text).toContain("PERMISSION wait: waiting");
    expect(text).toContain("TURN FINISHED");
    expect(text).toContain("TURN ENDED: boom");
    expect(text).toContain("TASK NOTIFICATION: Background command \"tests\" completed");
  });

  it("says when the thread is empty", () => {
    cards.set("c1", card());
    expect(readThreadText("c1", 5)).toContain("(empty thread)");
  });
});

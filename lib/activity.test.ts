import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-activity-"));
const board: { cards: Card[] } = { cards: [] };

vi.mock("./store", () => ({ DATA_DIR: dir, listCards: () => board.cards }));

const { publish } = await import("./bus");
const { ACTIVITY_FILE, append, backfillEvents, changeEvents, readActivity, record, recordLimit, trackActivity, withoutHandedOff } = await import("./activity");

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1", title: "Add login", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "review",
    createdAt: 1000, updatedAt: 1000, ...overrides,
  };
}

function reset() {
  const g = globalThis as Record<string, unknown>;
  (g.__weftActivity as { stop?: () => void } | undefined)?.stop?.();
  delete g.__weftActivity;
  fs.rmSync(ACTIVITY_FILE, { force: true });
  board.cards = [];
}

beforeEach(reset);
afterAll(() => {
  reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("backfillEvents", () => {
  it("turns each card's history into created, turn and done events, oldest first", () => {
    const events = backfillEvents([
      card({ id: "a", column: "done", createdAt: 5, updatedAt: 50, lastActivity: 40, turns: 3, costUsd: 1.5 }),
      card({ id: "b", createdAt: 1, updatedAt: 1 }),
      card({ id: "c", createdAt: 2, updatedAt: 9 }),
      card({ id: "copilot", role: "copilot" }),
    ]);
    expect(events.map((e) => e.id)).toEqual(["created:b", "created:c", "created:a", "turns:c", "turns:a", "done:a"]);
    expect(events.find((e) => e.id === "turns:a")).toMatchObject({ at: 40, turns: 3, cost: 1.5 });
    expect(events.find((e) => e.id === "turns:c")).toMatchObject({ at: 9, turns: 1 });
    expect(events.find((e) => e.id === "done:a")).toMatchObject({ at: 50, title: "Add login" });
  });

  it("skips a card handed to a worker: the worker's card counts that run", () => {
    const handedOff = { workerId: "w1", commandId: "cmd" };
    expect(backfillEvents([card({ id: "h", column: "done", turns: 2, handedOff })])).toEqual([]);
  });
});

describe("withoutHandedOff", () => {
  it("drops what a handed-off card logged before it was marked, and keeps the rest", () => {
    const events = [
      { id: "created:h", kind: "created" as const, at: 1, card: "h" },
      { id: "created:a", kind: "created" as const, at: 2, card: "a" },
      { id: "limit", kind: "limit" as const, at: 3 },
    ];
    const cards = [card({ id: "h", handedOff: { workerId: "w1", commandId: "cmd" } }), card({ id: "a" })];
    expect(withoutHandedOff(events, cards).map((e) => e.id)).toEqual(["created:a", "limit"]);
    expect(withoutHandedOff(events, [card({ id: "a" })])).toBe(events);
  });
});

describe("changeEvents", () => {
  it("backfills a card it hasn't seen", () => {
    expect(changeEvents(undefined, card(), 0, 99).map((e) => e.kind)).toEqual(["created"]);
  });

  it("logs new turns, a start with how many run at once, and reaching Done", () => {
    const now = 5000;
    const started = changeEvents({ column: "review", turns: 1 }, card({ column: "running", turns: 1 }), 3, now);
    expect(started).toMatchObject([{ kind: "start", running: 3, at: now }]);
    const finished = changeEvents({ column: "running", turns: 1 }, card({ column: "done", turns: 3, costUsd: 2 }), 0, now);
    expect(finished).toMatchObject([{ kind: "turn", turns: 2, cost: 2 }, { kind: "done", cost: 2, title: "Add login" }]);
    expect(changeEvents({ column: "done", turns: 0 }, card({ column: "done" }), 0, now)).toEqual([]);
  });

  it("logs nothing for a card handed to a worker", () => {
    const handedOff = { workerId: "w1", commandId: "cmd" };
    expect(changeEvents({ column: "review", turns: 0 }, card({ column: "done", turns: 1, handedOff }), 0, 5)).toEqual([]);
  });
});

describe("the log", () => {
  it("fills itself from the board the first time and appends by id after", () => {
    board.cards = [card({ id: "a" })];
    expect(readActivity().map((e) => e.id)).toEqual(["created:a"]);
    append([{ id: "created:a", kind: "created", at: 1 }, { id: "x", kind: "turn", at: 2 }]);
    record({ kind: "quality", at: 3, cwd: "/repo", score: 80 });
    expect(readActivity()).toHaveLength(3);
    expect(fs.readFileSync(ACTIVITY_FILE, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("reads an existing file, skipping broken lines", () => {
    fs.writeFileSync(ACTIVITY_FILE, `${JSON.stringify({ id: "a", kind: "turn", at: 1 })}\nnot json\n\n`);
    expect(readActivity()).toEqual([{ id: "a", kind: "turn", at: 1 }]);
  });

  it("loads the log before appending when nothing has read it yet", () => {
    fs.writeFileSync(ACTIVITY_FILE, "");
    append([{ id: "z", kind: "turn", at: 1 }]);
    expect(readActivity().map((e) => e.id)).toEqual(["z"]);
    append([]);
  });
});

describe("trackActivity", () => {
  it("backfills cards the log missed, then follows the board's card events", () => {
    fs.writeFileSync(ACTIVITY_FILE, `${JSON.stringify({ id: "created:old", kind: "created", at: 1 })}\n`);
    board.cards = [card({ id: "old" }), card({ id: "new", createdAt: 7, updatedAt: 7 }), card({ id: "copilot", role: "copilot" })];
    trackActivity();
    trackActivity();
    expect(readActivity().map((e) => e.id)).toEqual(["created:old", "created:new"]);

    publish({ type: "card", card: card({ id: "new", column: "running" }) });
    publish({ type: "card", card: card({ id: "copilot", role: "copilot", column: "running", turns: 5 }) });
    publish({ type: "card", card: card({ id: "new", column: "done", turns: 1 }) });
    publish({ type: "card", card: card({ id: "fresh", createdAt: 9, updatedAt: 9 }) });
    publish({ type: "card_deleted", id: "fresh" });
    publish({ type: "delta", cardId: "new", text: "hi" });
    expect(readActivity().map((e) => e.kind)).toEqual(["created", "created", "start", "turn", "done", "created"]);
    expect(readActivity()[2]).toMatchObject({ kind: "start", running: 1 });
  });

  it("keeps going when the log can't be written", () => {
    trackActivity();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    publish({ type: "card", card: card({ id: "x" }) });
    expect(warn).toHaveBeenCalled();
    write.mockRestore();
    warn.mockRestore();
  });

  it("ignores events before it starts following", () => {
    readActivity();
    publish({ type: "card", card: card({ id: "early" }) });
    expect(readActivity().map((e) => e.id)).not.toContain("created:early");
  });
});

describe("recordLimit", () => {
  it("logs a limit hit once per window reset", () => {
    readActivity();
    recordLimit("five_hour", 5, { id: "c1", cwd: "/repo" }, 300);
    recordLimit("five_hour", 6, { id: "c2", cwd: "/repo" }, 300);
    recordLimit("seven_day", 7);
    expect(readActivity().map((e) => [e.id.startsWith("limit:") ? e.id : "uuid", e.kind, e.limit, e.card])).toEqual([
      ["limit:five_hour:300", "limit", "five_hour", "c1"],
      ["uuid", "limit", "seven_day", undefined],
    ]);
  });

  it("keeps going when the log can't be written", () => {
    readActivity();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    recordLimit("five_hour", 5);
    expect(warn).toHaveBeenCalled();
    write.mockRestore();
    warn.mockRestore();
  });
});

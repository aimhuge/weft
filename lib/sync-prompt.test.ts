import { describe, expect, it } from "vitest";
import { looksScratch } from "./scratch";
import { finishedCount, promptFolder, promptOff, resetSyncPrompt, shouldAsk, SYNC_PROMPT_KEY, turnPromptOff, type PromptGate } from "./sync-prompt";
import { COPILOT_ID, type Card } from "./types";

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[SYNC_PROMPT_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const card = (over: Partial<Card>) => ({ id: "c1", cwd: "/Users/me/app", column: "review", updatedAt: 1, ...over }) as Card;

describe("the don't-show-again box", () => {
  it("is off until ticked, then stays until reset", () => {
    const s = memory();
    expect(promptOff(s)).toBe(false);
    turnPromptOff(s);
    expect(promptOff(s)).toBe(true);
    resetSyncPrompt(s);
    expect(promptOff(s)).toBe(false);
  });

  it("reads broken or missing storage as never ticked, and writing to it doesn't throw", () => {
    expect(promptOff(broken)).toBe(false);
    expect(() => turnPromptOff(broken)).not.toThrow();
    expect(() => resetSyncPrompt(broken)).not.toThrow();
    expect(promptOff(null)).toBe(false);
    expect(() => turnPromptOff(null)).not.toThrow();
  });

  it("falls back to localStorage", () => {
    const s = memory();
    const g = globalThis as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = s;
    try {
      turnPromptOff();
      expect(promptOff()).toBe(true);
      resetSyncPrompt();
      expect(s.data.size).toBe(0);
    } finally {
      g.localStorage = before;
    }
  });

  it("reads no localStorage at all as never ticked", () => {
    const g = globalThis as { localStorage?: unknown };
    const before = g.localStorage;
    delete g.localStorage;
    try {
      expect(promptOff()).toBe(false);
    } finally {
      if (before !== undefined) g.localStorage = before;
    }
  });

  it("treats a localStorage getter that throws as no storage", () => {
    const g = globalThis as object;
    const before = Object.getOwnPropertyDescriptor(g, "localStorage");
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(promptOff()).toBe(false);
    } finally {
      if (before) Object.defineProperty(g, "localStorage", before);
      else delete (g as { localStorage?: unknown }).localStorage;
    }
  });
});

describe("promptFolder", () => {
  it("asks about the project the board is narrowed to, once one of its threads has finished a turn", () => {
    expect(promptFolder("/Users/me/app", [card({})])).toBe("/Users/me/app");
    expect(promptFolder("/Users/me/app", [card({ column: "running" })])).toBeNull();
    expect(promptFolder("/Users/me/app", [card({ column: "backlog" })])).toBeNull();
    expect(promptFolder("/Users/me/other", [card({})])).toBeNull();
  });

  it("with no project picked, takes the folder of the card that moved last", () => {
    const cards = [card({ id: "a", cwd: "/Users/me/old", updatedAt: 1 }), card({ id: "b", cwd: "/Users/me/new", updatedAt: 5, column: "done" }), card({ id: "c", cwd: "/Users/me/mid", updatedAt: 3, column: "needs_you" })];
    expect(promptFolder(null, cards)).toBe("/Users/me/new");
    expect(promptFolder(undefined, [])).toBeNull();
  });

  it("skips the copilot, archived cards and scratch folders", () => {
    expect(promptFolder(null, [card({ id: COPILOT_ID })])).toBeNull();
    expect(promptFolder(null, [card({ archived: true })])).toBeNull();
    expect(promptFolder(null, [card({ cwd: "/Users/me/.claude/worktrees/x" })])).toBeNull();
    expect(looksScratch("/tmp/x")).toBe(true);
    expect(looksScratch("/Users/me/app")).toBe(false);
  });
});

describe("finishedCount", () => {
  it("counts threads that have finished a turn", () => {
    expect(finishedCount([card({}), card({ column: "running" }), card({ column: "backlog" }), card({ column: "done" })])).toBe(2);
  });
});

describe("shouldAsk", () => {
  const ready: PromptGate = { folder: "/Users/me/app", synced: [], welcomed: true, off: false, asked: false };

  it("asks once everything lines up", () => {
    expect(shouldAsk(ready)).toBe(true);
  });

  it("waits for a folder, the welcome and the sync list", () => {
    expect(shouldAsk({ ...ready, folder: null })).toBe(false);
    expect(shouldAsk({ ...ready, welcomed: false })).toBe(false);
    expect(shouldAsk({ ...ready, synced: null })).toBe(false);
  });

  it("never asks about a project already syncing, after don't show again, or twice a launch", () => {
    expect(shouldAsk({ ...ready, synced: ["/Users/me/app"] })).toBe(false);
    expect(shouldAsk({ ...ready, off: true })).toBe(false);
    expect(shouldAsk({ ...ready, asked: true })).toBe(false);
  });
});

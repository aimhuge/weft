// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  markStarAsked,
  markStarDone,
  readStar,
  resetStarPrompt,
  shouldAskStar,
  snoozeStar,
  STAR_PROMPT_AFTER,
  STAR_PROMPT_KEY,
  STAR_SNOOZE_MS,
  STAR_URL,
  starAskedThisLaunch,
  type StarGate,
} from "./star-prompt";

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

beforeEach(() => localStorage.clear());

describe("the stored answer", () => {
  it("is open until something is stored", () => {
    expect(readStar()).toEqual({ kind: "open" });
  });

  it("Don't ask (or starred) is done for good", () => {
    markStarDone();
    expect(localStorage.getItem(STAR_PROMPT_KEY)).toBe("done");
    expect(readStar()).toEqual({ kind: "done" });
  });

  it("Later waits two weeks", () => {
    snoozeStar(1000);
    expect(readStar()).toEqual({ kind: "snoozed", until: 1000 + STAR_SNOOZE_MS });
  });

  it("reads junk, missing or broken storage as done", () => {
    localStorage.setItem(STAR_PROMPT_KEY, "nope");
    expect(readStar()).toEqual({ kind: "done" });
    expect(readStar(null)).toEqual({ kind: "done" });
    expect(readStar(broken)).toEqual({ kind: "done" });
  });

  it("Reset tips clears it", () => {
    markStarDone();
    resetStarPrompt();
    expect(readStar()).toEqual({ kind: "open" });
  });

  it("shrugs off broken or missing storage when writing", () => {
    expect(() => markStarDone(broken)).not.toThrow();
    expect(() => snoozeStar(0, broken)).not.toThrow();
    expect(() => resetStarPrompt(broken)).not.toThrow();
    expect(() => markStarDone(null)).not.toThrow();
    expect(() => resetStarPrompt(null)).not.toThrow();
  });

  it("uses no storage when localStorage can't be reached", () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("denied");
      },
    });
    try {
      expect(readStar()).toEqual({ kind: "done" });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => undefined });
      expect(readStar()).toEqual({ kind: "done" });
    } finally {
      if (desc) Object.defineProperty(globalThis, "localStorage", desc);
    }
  });
});

describe("shouldAskStar", () => {
  const gate = (over: Partial<StarGate> = {}): StarGate => ({
    welcomed: true,
    stored: { kind: "open" },
    finished: STAR_PROMPT_AFTER,
    otherAsked: false,
    now: 5000,
    ...over,
  });

  it("asks once enough threads have finished", () => {
    expect(shouldAskStar(gate())).toBe(true);
  });

  it("waits for the welcome, enough finished threads, and a launch with no other dialog", () => {
    expect(shouldAskStar(gate({ welcomed: false }))).toBe(false);
    expect(shouldAskStar(gate({ finished: STAR_PROMPT_AFTER - 1 }))).toBe(false);
    expect(shouldAskStar(gate({ otherAsked: true }))).toBe(false);
  });

  it("never asks again once done, and Later asks again only after it runs out", () => {
    expect(shouldAskStar(gate({ stored: { kind: "done" } }))).toBe(false);
    expect(shouldAskStar(gate({ stored: { kind: "snoozed", until: 6000 } }))).toBe(false);
    expect(shouldAskStar(gate({ stored: { kind: "snoozed", until: 5000 } }))).toBe(true);
  });
});

describe("the launch flag", () => {
  it("records an ask this launch", () => {
    markStarAsked();
    expect(starAskedThisLaunch()).toBe(true);
    markStarAsked(false);
    expect(starAskedThisLaunch()).toBe(false);
  });
});

it("points at Weft's repo", () => {
  expect(STAR_URL).toBe("https://github.com/aimhuge/weft");
});

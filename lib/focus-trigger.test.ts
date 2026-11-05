import { describe, expect, it } from "vitest";
import {
  clearLastFocus,
  evaluateFocus,
  FOCUS_GAP_MS,
  focusTriggerFired,
  LAST_FOCUS_KEY,
  readLastFocus,
  shouldFire,
  writeLastFocus,
  type FocusStorage,
} from "./focus-trigger";

const HOUR = 60 * 60 * 1000;

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
} satisfies FocusStorage;

describe("the last focus", () => {
  it("is remembered, read back and cleared", () => {
    const store = memory();
    expect(readLastFocus(store)).toBeNull();
    writeLastFocus(1_700_000_000_000, store);
    expect(store.map.get(LAST_FOCUS_KEY)).toBe("1700000000000");
    expect(readLastFocus(store)).toBe(1_700_000_000_000);
    clearLastFocus(store);
    expect(readLastFocus(store)).toBeNull();
  });

  it("treats a corrupt or impossible value as no memory at all", () => {
    expect(readLastFocus(memory({ [LAST_FOCUS_KEY]: "soon" }))).toBeNull();
    expect(readLastFocus(memory({ [LAST_FOCUS_KEY]: "Infinity" }))).toBeNull();
    expect(readLastFocus(memory({ [LAST_FOCUS_KEY]: "-5" }))).toBeNull();
    expect(readLastFocus(memory({ [LAST_FOCUS_KEY]: "0" }))).toBeNull();
  });

  it("survives storage that throws, or none at all (the server)", () => {
    expect(readLastFocus(blocked)).toBeNull();
    expect(() => writeLastFocus(1, blocked)).not.toThrow();
    expect(() => clearLastFocus(blocked)).not.toThrow();
  });
});

describe("shouldFire", () => {
  it("fires once four hours have passed", () => {
    const now = 1_700_000_000_000;
    expect(shouldFire(now - FOCUS_GAP_MS, now)).toBe(true);
    expect(shouldFire(now - FOCUS_GAP_MS + 1, now)).toBe(false);
    expect(shouldFire(now - 4 * HOUR - HOUR, now)).toBe(true);
  });

  it("stays quiet for a lunch break", () => {
    const now = 1_700_000_000_000;
    expect(shouldFire(now - 30 * 60 * 1000, now)).toBe(false);
    expect(shouldFire(now - 2 * HOUR, now)).toBe(false);
  });

  it("needs to know the app had focus before", () => {
    expect(shouldFire(null, 1_700_000_000_000)).toBe(false);
  });

  it("takes the gap it's given", () => {
    const now = 1_700_000_000_000;
    expect(shouldFire(now - HOUR, now, HOUR)).toBe(true);
    expect(shouldFire(now - HOUR, now, 2 * HOUR)).toBe(false);
  });

  it("reads a clock that jumped backwards as no absence, not a long one", () => {
    const now = 1_700_000_000_000;
    expect(shouldFire(now + 10 * HOUR, now)).toBe(false);
  });
});

describe("evaluateFocus", () => {
  it("fires after four hours away and records this focus either way", () => {
    const store = memory();
    const now = 1_700_000_000_000;
    expect(evaluateFocus(now - 5 * HOUR, now, store)).toBe(true);
    expect(readLastFocus(store)).toBe(now);
  });

  it("ends the absence even when it doesn't fire, so a quick alt-tab can't fire it again", () => {
    const store = memory();
    const now = 1_700_000_000_000;
    expect(evaluateFocus(now - 5 * HOUR, now, store)).toBe(true);
    // Focus again a minute later: away for a minute, so no second fire.
    expect(evaluateFocus(now, now + 60_000, store)).toBe(false);
    expect(evaluateFocus(now + 60_000, now + 5 * HOUR, store)).toBe(true);
  });

  it("doesn't fire on a first focus, but remembers it", () => {
    const store = memory();
    const now = 1_700_000_000_000;
    expect(evaluateFocus(null, now, store)).toBe(false);
    expect(readLastFocus(store)).toBe(now);
  });
});

describe("focusTriggerFired", () => {
  it("fires for a real return after four hours", () => {
    const store = memory();
    const now = 1_700_000_000_000;
    writeLastFocus(now - 5 * HOUR, store);
    expect(focusTriggerFired(store, now)).toBe(true);
  });

  it("never fires without storage (the server)", () => {
    expect(focusTriggerFired(undefined, 1_700_000_000_000)).toBe(false);
  });

  it("never fires when storage refuses, and says nothing about it", () => {
    expect(focusTriggerFired(blocked, 1_700_000_000_000)).toBe(false);
  });
});

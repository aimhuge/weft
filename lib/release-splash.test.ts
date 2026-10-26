import { describe, expect, it } from "vitest";
import { decideSplash, recordSeen, resetSplash, seenVersion, SPLASH_SEEN_KEY, splashFor, type Splashes } from "./release-splash";

const SPLASHES: Splashes = {
  "0.7.0": { lines: ["One", "Two"], video: "/whats-new/0.7.0.mp4" },
  "0.6.9": { lines: [] },
};

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
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

describe("splashFor", () => {
  it("is the version's entry when it has lines", () => {
    expect(splashFor("0.7.0", SPLASHES)).toEqual(SPLASHES["0.7.0"]);
  });

  it("is null for a version with no entry, or an entry with no lines", () => {
    expect(splashFor("0.6.8", SPLASHES)).toBeNull();
    expect(splashFor("0.6.9", SPLASHES)).toBeNull();
  });

  it("reads the shipped file by default", () => {
    expect(splashFor("0.0.0")).toBeNull();
  });
});

describe("decideSplash", () => {
  it("shows the new version's splash after an update", () => {
    expect(decideSplash({ version: "0.7.0", seen: "0.6.9", welcomed: true }, SPLASHES)).toEqual({ show: SPLASHES["0.7.0"], record: true });
  });

  it("shows it to someone who had Weft before the splash existed", () => {
    expect(decideSplash({ version: "0.7.0", seen: null, welcomed: true }, SPLASHES).show).toEqual(SPLASHES["0.7.0"]);
  });

  it("does nothing on the version already seen", () => {
    expect(decideSplash({ version: "0.7.0", seen: "0.7.0", welcomed: true }, SPLASHES)).toEqual({ show: null, record: false });
  });

  it("records a fresh install's version without showing anything", () => {
    expect(decideSplash({ version: "0.7.0", seen: null, welcomed: false }, SPLASHES)).toEqual({ show: null, record: true });
  });

  it("records quietly on a downgrade", () => {
    expect(decideSplash({ version: "0.6.9", seen: "0.7.0", welcomed: true }, SPLASHES)).toEqual({ show: null, record: true });
    expect(decideSplash({ version: "0.7", seen: "0.7.0.1", welcomed: true }, SPLASHES)).toEqual({ show: null, record: true });
  });

  it("records quietly when the new version has no splash", () => {
    expect(decideSplash({ version: "0.6.9", seen: "0.6.2", welcomed: true }, SPLASHES)).toEqual({ show: null, record: true });
  });

  it("treats 0.7 and 0.7.0 as the same version, not a downgrade", () => {
    expect(decideSplash({ version: "0.7.0", seen: "0.7", welcomed: true }, SPLASHES)).toEqual({ show: SPLASHES["0.7.0"], record: true });
  });

  it("compares by number, not by text", () => {
    expect(decideSplash({ version: "0.7.0", seen: "0.10.0", welcomed: true }, SPLASHES).show).toBeNull();
    expect(decideSplash({ version: "0.7.0", seen: "0.6.10", welcomed: true }, SPLASHES).show).not.toBeNull();
  });
});

describe("the version seen", () => {
  it("records, reads and resets it", () => {
    const store = memory();
    expect(seenVersion(store)).toBeNull();
    recordSeen("0.7.0", store);
    expect(store.map.get(SPLASH_SEEN_KEY)).toBe("0.7.0");
    expect(seenVersion(store)).toBe("0.7.0");
    resetSplash(store);
    expect(seenVersion(store)).toBeNull();
  });

  it("survives blocked or missing storage", () => {
    expect(seenVersion(broken)).toBeNull();
    expect(() => recordSeen("0.7.0", broken)).not.toThrow();
    expect(() => resetSplash(broken)).not.toThrow();
    expect(seenVersion(null)).toBeNull();
    expect(() => recordSeen("0.7.0", null)).not.toThrow();
  });

  it("reads storage that throws on access as none", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(seenVersion()).toBeNull();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("uses the page's localStorage by default, and none where there is none", () => {
    expect(seenVersion()).toBeNull();
    expect(() => recordSeen("0.7.0")).not.toThrow();
    expect(() => resetSplash()).not.toThrow();
  });
});

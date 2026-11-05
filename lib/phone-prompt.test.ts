import { afterEach, describe, expect, it } from "vitest";
import { markPhonePromptSeen, PHONE_PROMPT_AFTER, PHONE_PROMPT_KEY, phonePromptSeen, resetPhonePrompt, shouldOfferPhone, type PhoneGate } from "./phone-prompt";

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[PHONE_PROMPT_KEY, initial]]);
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

describe("the seen flag", () => {
  it("is unseen until marked, then seen, until reset", () => {
    const s = memory();
    expect(phonePromptSeen(s)).toBe(false);
    markPhonePromptSeen(s);
    expect(s.data.get(PHONE_PROMPT_KEY)).toBe("1");
    expect(phonePromptSeen(s)).toBe(true);
    resetPhonePrompt(s);
    expect(s.data.size).toBe(0);
    expect(phonePromptSeen(s)).toBe(false);
  });

  it("reads any other stored value as unseen", () => {
    expect(phonePromptSeen(memory("0"))).toBe(false);
  });

  it("reads missing or broken storage as seen, and writing to it doesn't throw", () => {
    expect(phonePromptSeen(null)).toBe(true);
    expect(phonePromptSeen(broken)).toBe(true);
    expect(() => markPhonePromptSeen(null)).not.toThrow();
    expect(() => markPhonePromptSeen(broken)).not.toThrow();
    expect(() => resetPhonePrompt(null)).not.toThrow();
    expect(() => resetPhonePrompt(broken)).not.toThrow();
  });
});

describe("default storage", () => {
  const g = globalThis as { localStorage?: unknown };
  const descriptor = Object.getOwnPropertyDescriptor(g, "localStorage");
  afterEach(() => {
    if (descriptor) Object.defineProperty(g, "localStorage", descriptor);
    else delete g.localStorage;
  });

  it("falls back to localStorage", () => {
    const s = memory();
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: s });
    expect(phonePromptSeen()).toBe(false);
    markPhonePromptSeen();
    expect(phonePromptSeen()).toBe(true);
    resetPhonePrompt();
    expect(s.data.size).toBe(0);
  });

  it("reads no localStorage at all as seen", () => {
    Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: undefined });
    expect(phonePromptSeen()).toBe(true);
  });

  it("treats a localStorage getter that throws as no storage", () => {
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    expect(phonePromptSeen()).toBe(true);
    expect(() => markPhonePromptSeen()).not.toThrow();
  });
});

describe("shouldOfferPhone", () => {
  const ready: PhoneGate = {
    signedIn: true,
    welcomed: true,
    seen: false,
    finished: PHONE_PROMPT_AFTER,
    syncAsked: false,
    phones: 0,
    url: "https://testflight.apple.com/join/abc",
  };

  it("offers when every condition holds", () => {
    expect(shouldOfferPhone(ready)).toBe(true);
    expect(shouldOfferPhone({ ...ready, finished: PHONE_PROMPT_AFTER + 10 })).toBe(true);
  });

  it("waits for each condition", () => {
    expect(shouldOfferPhone({ ...ready, signedIn: false })).toBe(false);
    expect(shouldOfferPhone({ ...ready, welcomed: false })).toBe(false);
    expect(shouldOfferPhone({ ...ready, seen: true })).toBe(false);
    expect(shouldOfferPhone({ ...ready, syncAsked: true })).toBe(false);
    expect(shouldOfferPhone({ ...ready, finished: PHONE_PROMPT_AFTER - 1 })).toBe(false);
    expect(shouldOfferPhone({ ...ready, phones: 1 })).toBe(false);
    expect(shouldOfferPhone({ ...ready, phones: null })).toBe(false);
    expect(shouldOfferPhone({ ...ready, url: null })).toBe(false);
    expect(shouldOfferPhone({ ...ready, url: "" })).toBe(false);
  });
});

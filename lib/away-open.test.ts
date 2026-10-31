// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AWAY_COOKIE,
  AWAY_DEFAULTS,
  arrive,
  awayPrefs,
  awayStack,
  leaveAway,
  nextAway,
  selectedAway,
  setAwayOpener,
  setAwayPrefs,
  subscribeAwayStack,
} from "./away-open";

const ON = { on: true, minutes: 2 };
const AWAY = 3 * 60_000;

function clearCookie() {
  document.cookie = `${AWAY_COOKIE}=; path=/; max-age=0`;
}

describe("away prefs", () => {
  afterEach(clearCookie);

  it("starts off, at two minutes", () => {
    expect(awayPrefs()).toEqual(AWAY_DEFAULTS);
    expect(AWAY_DEFAULTS).toEqual({ on: false, minutes: 2 });
  });

  it("reads back what it wrote", () => {
    setAwayPrefs({ on: true, minutes: 5 });
    expect(awayPrefs()).toEqual({ on: true, minutes: 5 });
  });

  it("falls back on a bad minutes value or a broken cookie", () => {
    document.cookie = `${AWAY_COOKIE}=${encodeURIComponent(JSON.stringify({ on: true, minutes: -1 }))}; path=/`;
    expect(awayPrefs()).toEqual({ on: true, minutes: 2 });
    document.cookie = `${AWAY_COOKIE}=${encodeURIComponent(JSON.stringify({ on: "yes" }))}; path=/`;
    expect(awayPrefs()).toEqual({ on: false, minutes: 2 });
    document.cookie = `${AWAY_COOKIE}=%7Bnot-json; path=/`;
    expect(awayPrefs()).toEqual(AWAY_DEFAULTS);
  });
});

describe("the away stack", () => {
  const open = vi.fn();

  beforeEach(() => {
    open.mockReset();
    setAwayOpener(open);
    selectedAway(null);
  });

  afterEach(() => setAwayOpener(null));

  const at = (id: string, selected: string | null, over: Partial<Parameters<typeof arrive>[0]> = {}) =>
    arrive({ id, selected, busy: false, idleMs: AWAY, prefs: ON, ...over });

  it("does nothing while off or while you're at the board", () => {
    expect(at("a", null, { prefs: { on: false, minutes: 2 } })).toBeNull();
    expect(at("a", null, { idleMs: 60_000 })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(awayStack()).toEqual([]);
  });

  it("opens the first card when nothing is open, and stacks the next ones", () => {
    const listener = vi.fn();
    const stop = subscribeAwayStack(listener);
    expect(at("a", null)).toBe("open");
    expect(open).toHaveBeenCalledWith("a");
    expect(at("b", "a")).toBe("stack");
    expect(at("b", "a")).toBeNull();
    expect(awayStack()).toEqual(["a", "b"]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    at("c", "a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("never opens over the New thread form or a card you opened yourself", () => {
    expect(at("a", null, { busy: true })).toBeNull();
    expect(at("a", "mine")).toBeNull();
    expect(awayStack()).toEqual([]);
  });

  it("Next opens the next card still waiting, and the last one empties the stack", () => {
    at("a", null);
    at("b", "a");
    at("c", "a");
    expect(nextAway((id) => id !== "b")).toBe("c");
    expect(open).toHaveBeenLastCalledWith("c");
    expect(awayStack()).toEqual(["c"]);
    expect(nextAway()).toBeNull();
    expect(awayStack()).toEqual([]);
  });

  it("answering the open card moves on; one further back just leaves", () => {
    at("a", null);
    at("b", "a");
    at("c", "a");
    expect(leaveAway("x")).toBeNull();
    expect(leaveAway("b")).toBeNull();
    expect(awayStack()).toEqual(["a", "c"]);
    expect(leaveAway("a")).toBe("c");
    expect(leaveAway("c")).toBeNull();
    expect(awayStack()).toEqual([]);
  });

  it("opening another card yourself, or closing the panel, ends the stack", () => {
    at("a", null);
    at("b", "a");
    selectedAway("a");
    expect(awayStack()).toEqual(["a", "b"]);
    selectedAway("other");
    expect(awayStack()).toEqual([]);
    selectedAway(null);
    expect(awayStack()).toEqual([]);
  });

  it("Next and an answered card skip ones the board says aren't waiting any more", () => {
    setAwayOpener(open, (id) => id !== "b");
    at("a", null);
    at("b", "a");
    at("c", "a");
    expect(leaveAway("a")).toBe("c");
    expect(awayStack()).toEqual(["c"]);
  });

  it("the last card answered leaves the stack empty and the panel where it is", () => {
    at("a", null);
    open.mockClear();
    expect(leaveAway("a")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("works without an opener", () => {
    setAwayOpener(null);
    expect(at("a", null)).toBe("open");
    at("b", "a");
    expect(nextAway()).toBe("b");
  });
});

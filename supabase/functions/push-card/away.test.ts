import { describe, expect, it } from "vitest";
import { isAway, macActive, phoneForeground, presentOn } from "./away";

const now = Date.parse("2026-11-15T05:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("macActive", () => {
  it("is a fresh heartbeat with the user touching the Mac", () => {
    expect(macActive([{ idle_seconds: 12, updated_at: ago(30_000) }], now)).toBe(true);
  });
  it("is not a Mac idle for 5 minutes or more", () => {
    expect(macActive([{ idle_seconds: 300, updated_at: ago(10_000) }], now)).toBe(false);
  });
  it("is not a stale heartbeat, however busy it said it was", () => {
    expect(macActive([{ idle_seconds: 0, updated_at: ago(3 * 60_000 + 1) }], now)).toBe(false);
    expect(macActive([{ idle_seconds: 0, updated_at: null }], now)).toBe(false);
    expect(macActive([{ idle_seconds: null, updated_at: ago(1000) }], now)).toBe(false);
  });
  it("takes any one active Mac", () => {
    expect(macActive([{ idle_seconds: 900, updated_at: ago(1000) }, { idle_seconds: 5, updated_at: ago(1000) }], now)).toBe(true);
  });
});

describe("phoneForeground", () => {
  it("is the app open in the last 2 minutes", () => {
    expect(phoneForeground([{ foreground_at: ago(60_000) }], now)).toBe(true);
    expect(phoneForeground([{ foreground_at: ago(2 * 60_000 + 1) }], now)).toBe(false);
    expect(phoneForeground([{ foreground_at: null }], now)).toBe(false);
    expect(phoneForeground([{ foreground_at: "garbage" }], now)).toBe(false);
  });
});

describe("presentOn / isAway", () => {
  it("is away with no presence rows at all", () => {
    expect(presentOn([], [], now)).toBeNull();
    expect(isAway([], [{ foreground_at: null }], now)).toBe(true);
  });
  it("is present on an active Mac", () => {
    expect(presentOn([{ idle_seconds: 3, updated_at: ago(5000) }], [], now)).toBe("mac");
    expect(isAway([{ idle_seconds: 3, updated_at: ago(5000) }], [], now)).toBe(false);
  });
  it("is away from an idle Mac", () => {
    expect(isAway([{ idle_seconds: 600, updated_at: ago(5000) }], [{ foreground_at: null }], now)).toBe(true);
  });
  it("is away when the only heartbeat is stale", () => {
    expect(isAway([{ idle_seconds: 1, updated_at: ago(10 * 60_000) }], [], now)).toBe(true);
  });
  it("is present with the phone app in the foreground", () => {
    expect(presentOn([{ idle_seconds: 600, updated_at: ago(5000) }], [{ foreground_at: ago(10_000) }], now)).toBe("phone");
  });
});

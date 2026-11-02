import { describe, expect, it } from "vitest";
import {
  allowSubject,
  DEFAULT_SETTINGS,
  expiryOf,
  HOLD_MARGIN_MS,
  isLive,
  looser,
  mintMessage,
  REPO_RE,
  reusable,
  ROTATE_MS,
  settingsOf,
  type GrantSettings,
} from "./connector-grant";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");

describe("settingsOf", () => {
  it("defaults everything from nothing", () => {
    expect(settingsOf(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf("x")).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps known values and replaces unknown ones", () => {
    expect(settingsOf({ scope: "card", approval: "project", lifetime: "8h", asks: [] })).toEqual({ scope: "card", approval: "project", lifetime: "8h", asks: [] });
    expect(settingsOf({ scope: "everything", approval: "nobody", lifetime: "forever", asks: ["delete_repo", "protected_push", "protected_push"] })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("looser", () => {
  const base: GrantSettings = { scope: "project", approval: "project", lifetime: "24h", asks: ["protected_push"] };
  it("is false for the same or a stricter change", () => {
    expect(looser(base, base)).toBe(false);
    expect(looser(base, { ...base, scope: "card", approval: "card", lifetime: "8h" })).toBe(false);
  });
  it("is true for a wider scope, a weaker approval, a longer lifetime or a dropped ask", () => {
    expect(looser(base, { ...base, scope: "installed" })).toBe(true);
    expect(looser(base, { ...base, approval: "worker" })).toBe(true);
    expect(looser(base, { ...base, lifetime: "revoked" })).toBe(true);
    expect(looser(base, { ...base, asks: [] })).toBe(true);
  });
});

describe("expiryOf and isLive", () => {
  it("ends a timed grant and never ends an until-revoked one", () => {
    expect(expiryOf("revoked", NOW)).toBeNull();
    expect(expiryOf("8h", NOW)).toBe(new Date(NOW + 8 * 3_600_000).toISOString());
    expect(expiryOf("24h", NOW)).toBe(new Date(NOW + 24 * 3_600_000).toISOString());
  });
  it("is live with no expiry or one still ahead", () => {
    expect(isLive(null, NOW)).toBe(true);
    expect(isLive(undefined, NOW)).toBe(true);
    expect(isLive(new Date(NOW + 1).toISOString(), NOW)).toBe(true);
    expect(isLive(new Date(NOW).toISOString(), NOW)).toBe(false);
  });
});

describe("allowSubject", () => {
  const card = { id: "c1", repo: "o/r" };
  it("names nothing under per-worker approval, the repo per project and the card per card", () => {
    expect(allowSubject("worker", card)).toBeNull();
    expect(allowSubject("project", card)).toEqual({ kind: "project", subject: "o/r" });
    expect(allowSubject("card", card)).toEqual({ kind: "card", subject: "c1" });
  });
});

describe("mintMessage, REPO_RE and reusable", () => {
  it("signs every field in a fixed order", () => {
    expect(mintMessage({ workerId: "w", cardId: "c", connector: "github", repo: "o/r", ts: 1, nonce: "n" })).toBe('["weft-connector-mint-v1","w","c","github","o/r",1,"n"]');
  });
  it("takes owner/name only", () => {
    expect(REPO_RE.test("fotoflo/weft")).toBe(true);
    expect(REPO_RE.test("fotoflo/weft/x")).toBe(false);
    expect(REPO_RE.test("fotoflo")).toBe(false);
  });
  it("hands a token out until the hold margin before its rotation", () => {
    expect(reusable(NOW, NOW)).toBe(true);
    expect(reusable(NOW, NOW + ROTATE_MS - HOLD_MARGIN_MS - 1)).toBe(true);
    expect(reusable(NOW, NOW + ROTATE_MS - HOLD_MARGIN_MS)).toBe(false);
  });
});
